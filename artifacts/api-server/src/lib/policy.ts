import crypto from "node:crypto";
import { db } from "@workspace/db";
import { approvals } from "@workspace/db";
import { and, eq, gt, desc } from "drizzle-orm";
import { logger } from "./logger";
import { isIsolatedBackend } from "./code-sandbox";

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
  // ACHTUNG: gilt nur für das Container-Backend. Steht LUKAS_EXECUTION_BACKEND
  // auf ssh/host, landet derselbe Befehl direkt auf dem Droplet — dann stuft
  // riskFor() unten automatisch auf R3 hoch. Siehe dort.
  execute_command: "R1",
  reset_sandbox: "R1",

  // R2 — Wirkung nach außen
  email_send: "R2",

  // R3 — Host-Ebene: von dort sind Trading-Credentials, Wallet-Keys, die
  // Postgres und die laufenden Bots erreichbar. Jeder einzelne Befehl braucht
  // Freigabe, gebunden an genau diesen Wortlaut. Bewusst KEINE Ausnahme für
  // "harmlos aussehende" Befehle: ob `curl … | bash` harmlos ist, hängt
  // ausschließlich davon ab, was gerade unter der URL liegt.
  execute_on_host: "R3",
};

/*
 * Unbekannte Tools sind absichtlich R2, nicht R0: wer künftig ein Tool
 * ergänzt und die Einstufung vergisst, bekommt eine Freigabepflicht statt
 * versehentlich freie Fahrt. Fail closed.
 */
export const DEFAULT_RISK: RiskTier = "R2";

export function riskFor(tool: string): RiskTier {
  /*
   * execute_command ist nur deshalb R1, WEIL der Befehl in einem Container
   * landet, der die Produktions-Secrets nicht sehen kann. Diese Begründung
   * fällt weg, sobald LUKAS_EXECUTION_BACKEND auf ssh oder host steht: dann
   * ist es faktisch dasselbe wie execute_on_host, also R3.
   *
   * Die Einstufung hängt damit an der Betriebsart, nicht an einer Zusage im
   * Prompt — genau so, wie es sein muss. Wer die Isolation abschaltet, schaltet
   * damit nicht versehentlich auch die Freigabepflicht ab.
   */
  if (tool === "execute_command" && !isIsolatedBackend()) return "R3";
  return TOOL_RISK[tool] ?? DEFAULT_RISK;
}

export function needsApproval(tier: RiskTier): boolean {
  return tier === "R2" || tier === "R3";
}

/*
 * Tools, bei denen eine ausdrückliche Bestätigung IN DER LAUFENDEN NACHRICHT
 * die Dashboard-Freigabe ersetzt.
 *
 * Warum das sicher ist: Geprüft wird Issas eigener, unveränderter Nachrichten-
 * text dieses Zuges. Eine Prompt-Injection in einer gelesenen E-Mail oder
 * Webseite kann darin nichts unterbringen — sie steht in Tool-Ausgaben, nicht
 * in dem, was Issa getippt hat. Sagt er "schick das ab", ist das dieselbe
 * bewusste Entscheidung wie ein Klick im Dashboard, nur ohne Umweg.
 *
 * Warum trotzdem nicht für alles: R3 (Host-Zugriff) bleibt IMMER bei der
 * Dashboard-Freigabe. Dort will man den exakten Befehl vor Augen haben, und
 * ein beiläufiges "mach mal" im Chat ist dafür keine ausreichende Grundlage.
 *
 * Läuft kein Nutzerzug (autonomer Hintergrund-Task, Cron), greift diese
 * Abkürzung nicht — dann bleibt es bei der Freigabe im Dashboard.
 */
const CONSENT_IN_TURN: Record<string, (userMessage: string) => boolean> = {
  email_send: (msg) =>
    /\bsend(e|en|et)?\b|\bschick(e|en|t)?\b|\babschicken\b|\bverschick(e|en|t)?\b|\braus damit\b/i.test(
      msg,
    ),
};

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
  rawUserMessage?: string,
): Promise<PolicyDecision> {
  const tier = riskFor(tool);
  if (!needsApproval(tier)) return { allow: true };

  // Ausdrückliche Bestätigung im laufenden Zug ersetzt die Dashboard-Freigabe
  // (nur R2, nur für Tools mit definierter Bestätigungsprüfung).
  const consentCheck = CONSENT_IN_TURN[tool];
  if (tier === "R2" && consentCheck && rawUserMessage && consentCheck(rawUserMessage)) {
    logger.info({ tool }, "Freigabe durch ausdrückliche Bestätigung im Chat");
    return { allow: true };
  }

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
