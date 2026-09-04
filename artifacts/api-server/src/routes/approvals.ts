import { Router } from "express";
import { db } from "@workspace/db";
import { approvals } from "@workspace/db";
import { desc, eq, and, gt } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

const serialize = (r: typeof approvals.$inferSelect) => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
  expiresAt: r.expiresAt.toISOString(),
  expired: r.status === "pending" && r.expiresAt.getTime() < Date.now(),
});

/** Offene und zuletzt entschiedene Freigaben. */
router.get("/lukas/approvals", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(approvals)
      .orderBy(desc(approvals.createdAt))
      .limit(50);
    res.json(rows.map(serialize));
  } catch (err) {
    logger.error({ err }, "Approvals laden fehlgeschlagen");
    res.status(500).json({ error: "Failed to load approvals" });
  }
});

/*
 * Wie weit eine Auftragsfreigabe aus dem Dashboard reicht. Dieselben Werte wie
 * bei der Zustimmung im Chat — es ist dieselbe Entscheidung, nur an einer
 * anderen Stelle getroffen.
 */
const AUFTRAG_AUFRUFE = Number(process.env.LUKAS_AUFTRAG_AUFRUFE ?? 25);
const AUFTRAG_MINUTEN = Number(process.env.LUKAS_AUFTRAG_MINUTEN ?? 30);

async function decide(
  id: number,
  status: "allowed" | "denied",
  fuerAuftrag = false,
) {
  const now = new Date();

  /*
   * "Fuer diese Aufgabe" braucht zweierlei, sonst wird daraus ein Freibrief:
   *
   *   - eine Unterhaltung. Ohne sie waere die Freigabe an nichts gebunden und
   *     wuerde auch autonome Laeufe decken.
   *   - eine Stufe unter R3. Geld, Zugangsdaten und Unumkehrbares bleiben bei
   *     der Einzelfreigabe, auch wenn hier jemand auf den anderen Knopf drueckt.
   *
   * Trifft eines davon nicht zu, wird still auf die Einmalfreigabe
   * zurueckgefallen — und der Aufrufer erfaehrt es am zurueckgegebenen Datensatz.
   */
  const [vorhanden] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
  const alsAuftrag =
    fuerAuftrag &&
    status === "allowed" &&
    vorhanden?.conversationId != null &&
    vorhanden?.riskTier !== "R3";

  const werte = alsAuftrag
    ? {
        status,
        decidedAt: now,
        geltung: "auftrag",
        verbleibend: AUFTRAG_AUFRUFE,
        expiresAt: new Date(now.getTime() + AUFTRAG_MINUTEN * 60 * 1000),
      }
    : { status, decidedAt: now };

  // Nur offene und noch nicht abgelaufene Anfragen sind entscheidbar — sonst
  // koennte eine alte Anfrage nachtraeglich "wiederbelebt" werden.
  const [row] = await db
    .update(approvals)
    .set(werte)
    .where(
      and(
        eq(approvals.id, id),
        eq(approvals.status, "pending"),
        gt(approvals.expiresAt, now),
      ),
    )
    .returning();
  return row;
}

/*
 * Zwei Wege, ja zu sagen.
 *
 *   /allow          — dieser eine Aufruf.
 *   /allow-auftrag  — dieses Werkzeug in dieser Unterhaltung, befristet und
 *                     gezaehlt.
 *
 * Der zweite existiert, weil "generier mir sechs Clips" EINE Entscheidung ist.
 * Sie in sechs Freigaben zu zerlegen macht sie nicht sicherer — nach der
 * dritten klickt niemand mehr sorgfaeltig, sondern nur noch schnell.
 */
router.post("/lukas/approvals/:id/allow-auftrag", async (req, res) => {
  try {
    const row = await decide(parseInt(String(req.params.id)), "allowed", true);
    if (!row) {
      return void res
        .status(404)
        .json({ error: "Nicht gefunden, bereits entschieden oder abgelaufen" });
    }
    logger.info(
      { approvalId: row.id, tool: row.tool, geltung: row.geltung },
      "Freigabe erteilt — für den Auftrag",
    );
    res.json(serialize(row));
  } catch (err) {
    logger.error({ err }, "Auftragsfreigabe fehlgeschlagen");
    res.status(500).json({ error: "Failed to allow" });
  }
});

router.post("/lukas/approvals/:id/allow", async (req, res) => {
  try {
    const row = await decide(parseInt(String(req.params.id)), "allowed");
    if (!row) {
      return void res
        .status(404)
        .json({ error: "Nicht gefunden, bereits entschieden oder abgelaufen" });
    }
    logger.info({ approvalId: row.id, tool: row.tool }, "Freigabe erteilt");
    res.json(serialize(row));
  } catch (err) {
    logger.error({ err }, "Freigabe fehlgeschlagen");
    res.status(500).json({ error: "Failed to allow" });
  }
});

router.post("/lukas/approvals/:id/deny", async (req, res) => {
  try {
    const row = await decide(parseInt(String(req.params.id)), "denied");
    if (!row) {
      return void res
        .status(404)
        .json({ error: "Nicht gefunden, bereits entschieden oder abgelaufen" });
    }
    logger.info({ approvalId: row.id, tool: row.tool }, "Freigabe verweigert");
    res.json(serialize(row));
  } catch (err) {
    logger.error({ err }, "Ablehnung fehlgeschlagen");
    res.status(500).json({ error: "Failed to deny" });
  }
});

export default router;
