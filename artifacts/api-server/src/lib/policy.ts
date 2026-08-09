import crypto from "node:crypto";
import { db } from "@workspace/db";
import { approvals } from "@workspace/db";
import { and, eq, gt, desc } from "drizzle-orm";
import { logger } from "./logger";

/*
 * Policy Decision Point.
 *
 * Der Leitsatz der Zielarchitektur: Ein LLM ist niemals ein
 * Autorisierungsserver. Lukas darf entscheiden, WAS er tun möchte — ob es
 * ausgeführt wird, entscheidet dieser Code, nachdem das Modell gesprochen hat
 * und bevor das Tool mit den echten Credentials läuft.
 *
 * Diese Datei ist bewusst frei von Modell-Einfluss: keine Prompt-Eingabe kann
 * eine Stufe herabsetzen oder eine Freigabe erzeugen.
 */

export type RiskTier = "R0" | "R1" | "R2" | "R3";

/*
 * R0 — nur lesen: läuft automatisch, wird protokolliert.
 * R1 — interner, umkehrbarer Schreibzugriff (eigenes Gedächtnis, eigene
 *      Sandbox): läuft automatisch.
 * R2 — Wirkung nach außen oder auf Produktion: braucht Freigabe.
 * R3 — Geld, Credentials, zerstörend oder unumkehrbar: braucht Freigabe,
 *      zusätzlich gelten die deterministischen Limits des jeweiligen Dienstes.
 */
export const TOOL_RISK: Record<string, RiskTier> = {
  // R0 — lesend
  query_memory: "R0",
  fetch_url: "R0",
  web_search: "R0",
  get_trading_stats: "R0",
  get_moltbook_activity: "R0",
  github_list_repos: "R0",
  github_read_path: "R0",
  github_search_code: "R0",
  email_search: "R0",
  email_read: "R0",

  // R1 — interner Schreibzugriff, umkehrbar
  save_memory: "R1",
  create_goal: "R1",
  update_goal: "R1",
  write_diary: "R1",
  feel: "R1",
  set_status: "R1",
  // Die Sandbox ist ein isolierter Wegwerf-Container ohne Produktions-Secrets
  // und per reset_sandbox jederzeit zurücksetzbar — deshalb R1 und nicht R3.
  // Bekäme Lukas eine Shell auf dem Host, wäre es zwingend R3.
  execute_command: "R1",
  reset_sandbox: "R1",

  // R2 — Wirkung nach außen
  email_send: "R2",
};

/*
 * Unbekannte Tools sind absichtlich R2, nicht R0: wer künftig ein Tool
 * ergänzt und die Einstufung vergisst, bekommt eine Freigabepflicht statt
 * versehentlich freie Fahrt. Fail closed.
 */
export const DEFAULT_RISK: RiskTier = "R2";

export function riskFor(tool: string): RiskTier {
  return TOOL_RISK[tool] ?? DEFAULT_RISK;
}

export function needsApproval(tier: RiskTier): boolean {
  return tier === "R2" || tier === "R3";
}

/*
 * Argumente stabil hashen: Schlüssel sortiert, damit dieselben Argumente in
 * anderer Reihenfolge denselben Hash ergeben — sonst könnte eine Freigabe
 * durch bloßes Umsortieren umgangen bzw. unbrauchbar werden.
 */
export function hashArguments(tool: string, input: Record<string, unknown>): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, normalize(val)]),
      );
    }
    return v;
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ tool, args: normalize(input) }))
    .digest("hex");
}

function preview(input: Record<string, unknown>): string {
  const text = JSON.stringify(input, null, 2);
  return text.length > 2000 ? text.slice(0, 2000) + "\n… (gekürzt)" : text;
}

export type PolicyDecision =
  | { allow: true }
  | { allow: false; approvalId: number; message: string };

const APPROVAL_TTL_MINUTES = 30;

/**
 * Prüft einen Tool-Aufruf. Gibt entweder Freigabe oder legt eine offene
 * Freigabe-Anfrage an, die Issa im Dashboard entscheidet.
 */
export async function checkPolicy(
  tool: string,
  input: Record<string, unknown>,
  conversationId?: number,
): Promise<PolicyDecision> {
  const tier = riskFor(tool);
  if (!needsApproval(tier)) return { allow: true };

  const hash = hashArguments(tool, input);
  const now = new Date();

  // Gibt es eine gültige, noch nicht verbrauchte Freigabe für GENAU diese
  // Argumente?
  const [existing] = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.argumentsHash, hash),
        eq(approvals.status, "allowed"),
        gt(approvals.expiresAt, now),
      ),
    )
    .orderBy(desc(approvals.createdAt))
    .limit(1);

  if (existing) {
    // Einmalgebrauch: sofort entwerten, damit dieselbe Freigabe nicht mehrfach
    // greift.
    await db
      .update(approvals)
      .set({ status: "used", decidedAt: now })
      .where(eq(approvals.id, existing.id));
    logger.info({ tool, approvalId: existing.id }, "Freigabe eingelöst");
    return { allow: true };
  }

  // Keine gültige Freigabe -> Anfrage anlegen (oder bestehende offene nutzen).
  const [pending] = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.argumentsHash, hash),
        eq(approvals.status, "pending"),
        gt(approvals.expiresAt, now),
      ),
    )
    .limit(1);

  const row =
    pending ??
    (
      await db
        .insert(approvals)
        .values({
          conversationId: conversationId ?? null,
          tool,
          riskTier: tier,
          argumentsHash: hash,
          argumentsPreview: preview(input),
          status: "pending",
          expiresAt: new Date(now.getTime() + APPROVAL_TTL_MINUTES * 60 * 1000),
        })
        .returning()
    )[0];

  logger.info({ tool, tier, approvalId: row.id }, "Freigabe angefordert");

  return {
    allow: false,
    approvalId: row.id,
    message:
      `NICHT ausgeführt — "${tool}" ist als ${tier} eingestuft und braucht Issas ausdrückliche Freigabe. ` +
      `Eine Anfrage (#${row.id}) liegt jetzt im Dashboard unter "Freigaben". ` +
      `Sag Issa, was du vorhast und warum, und bitte ihn, es dort freizugeben. ` +
      `Versuche NICHT, das über ein anderes Tool zu umgehen.`,
  };
}
