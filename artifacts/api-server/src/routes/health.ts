/*
 * Zwei Fragen, die nicht dasselbe sind — und die vorher beide mit demselben
 * "ok" beantwortet wurden.
 *
 *  /healthz  — LEBT der Prozess? Muss billig sein: eine Weiche fragt das im
 *              Sekundentakt, und eine Gesundheitsprobe, die selbst die
 *              Datenbank belastet, faellt bei Last als Erstes um und loest
 *              damit genau den Neustart aus, den sie verhindern soll.
 *
 *  /readyz   — KANN er gerade arbeiten? Hier wird die Datenbank tatsaechlich
 *              angefasst. Vorher meldete der Server fröhlich "ok", waehrend
 *              jede einzelne Anfrage an einer toten Datenbank scheiterte; im
 *              Dashboard sah alles gruen aus.
 *
 * Und beim Herunterfahren meldet /healthz 503, BEVOR irgendetwas abgebaut
 * wird. Das ist der eigentliche Zweck des Umwegs: eine Weiche soll aufhoeren,
 * Anfragen herzuschicken, solange wir sie noch beantworten koennen.
 */
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { istImAbschied } from "../lib/abschied";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  if (istImAbschied()) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  if (istImAbschied()) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  const begonnen = Date.now();
  try {
    /*
     * Mit Frist. Ohne sie haengt die Probe genau so lange wie die kaputte
     * Datenbank — und eine Gesundheitsprobe, die nicht antwortet, ist
     * schlimmer als eine, die "nein" sagt.
     */
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, ab) => setTimeout(() => ab(new Error("Zeitüberschreitung")), 3000)),
    ]);
    res.json({ status: "ok", datenbankMs: Date.now() - begonnen });
  } catch (err) {
    res.status(503).json({
      status: "degraded",
      datenbank: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
