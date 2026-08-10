import { Router } from "express";
import { z } from "zod";
import { listProposals, decideProposal, type Decision } from "../lib/proposals";
import { logger } from "../lib/logger";
import type { CodeProposal } from "@workspace/db";

const router = Router();

const serialize = (r: CodeProposal) => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
});

router.get("/lukas/proposals", async (_req, res) => {
  try {
    res.json((await listProposals()).map(serialize));
  } catch (err) {
    logger.error({ err }, "Vorschläge laden fehlgeschlagen");
    res.status(500).json({ error: "Failed to load proposals" });
  }
});

const DecisionBody = z.object({
  // Beim Zurückschicken ist der Kommentar der ganze Punkt — ohne ihn weiß
  // Lukas nicht, was er anders machen soll.
  comment: z.string().max(4000).optional(),
});

function decisionRoute(path: string, decision: Decision) {
  router.post(`/lukas/proposals/:id/${path}`, async (req, res) => {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id)) return void res.status(400).json({ error: "Ungültige ID" });

    const parsed = DecisionBody.safeParse(req.body ?? {});
    if (!parsed.success) return void res.status(400).json({ error: "Ungültiger Kommentar" });

    if (decision === "revision" && !parsed.data.comment?.trim()) {
      return void res
        .status(400)
        .json({ error: "Zum Zurückschicken braucht Lukas einen Kommentar." });
    }

    try {
      const row = await decideProposal(id, decision, parsed.data.comment?.trim());
      logger.info({ proposalId: id, decision, status: row.status }, "Vorschlag entschieden");
      res.json(serialize(row));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fehler";
      logger.error({ err, proposalId: id }, "Entscheidung fehlgeschlagen");
      res.status(400).json({ error: message });
    }
  });
}

decisionRoute("accept", "accept");
decisionRoute("reject", "reject");
decisionRoute("revise", "revision");

export default router;
