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

async function decide(id: number, status: "allowed" | "denied") {
  const now = new Date();
  // Nur offene und noch nicht abgelaufene Anfragen sind entscheidbar — sonst
  // koennte eine alte Anfrage nachtraeglich "wiederbelebt" werden.
  const [row] = await db
    .update(approvals)
    .set({ status, decidedAt: now })
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
