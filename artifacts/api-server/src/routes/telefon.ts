/*
 * Telefon: der Webhook fuer Anrufe und die Verwaltung der Nummern.
 *
 * Der Webhook liegt bewusst in einem eigenen Router. Er wird — wie der
 * WhatsApp-Webhook, aus demselben Grund — VOR lukasAuth gemountet: OpenAI ruft
 * ihn auf und kann keinen privaten Bearer-Token mitschicken. Abgesichert ist er
 * stattdessen durch die signierte Zustellung; ohne gueltige Signatur passiert
 * hier gar nichts.
 */
import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { telefonNummern } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai";
import {
  nimmAn, weiseAb, nummerAusSip, normalisiere, letzteAnrufe, protokolliere, twilioZugang,
  twilioStand, twilioEinrichten, starteAnruf,
} from "../lib/telefon";
import { logger } from "../lib/logger";
import { sendeSms, letzteSms, zugangVorhanden } from "../lib/sms";
import { recordDebugEvent } from "../lib/debug-log";

export const telefonWebhookRouter = Router();

telefonWebhookRouter.post("/telefon/eingehend", async (req, res) => {
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    return void res.status(400).send("kein Body");
  }

  let ereignis: { type?: string; data?: { call_id?: string; sip_headers?: Array<{ name: string; value: string }> } };
  try {
    /*
     * unwrap() prueft die Signatur UND den Zeitstempel und wirft, wenn etwas
     * nicht stimmt. Ohne OPENAI_WEBHOOK_SECRET wirft es ebenfalls — genau
     * richtig: ein ungeprueft angenommener Anruf waere ein offenes Mikrofon
     * in Issas Wohnung.
     */
    ereignis = openai.webhooks.unwrap(rawBody.toString("utf8"), req.headers as Record<string, string>) as typeof ereignis;
  } catch (err) {
    recordDebugEvent("telefon/webhook", err);
    return void res.status(401).send("ungültige Signatur");
  }

  if (ereignis.type !== "realtime.call.incoming") {
    // Andere Ereignisse bestaetigen wir, statt sie als Fehler zu melden —
    // sonst versucht OpenAI sie endlos erneut zuzustellen.
    return void res.status(200).send("ignoriert");
  }

  const callId = ereignis.data?.call_id;
  if (!callId) return void res.status(400).send("call_id fehlt");

  const from = ereignis.data?.sip_headers?.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
  const nummer = nummerAusSip(from);

  /*
   * Sofort bestaetigen, dann annehmen.
   *
   * Das Annehmen holt Erinnerungen aus der Datenbank und baut den Prompt —
   * das dauert. Wer solange mit der Webhook-Antwort wartet, riskiert, dass
   * OpenAI die Zustellung fuer gescheitert haelt und ein zweites Mal
   * zustellt: derselbe Anruf wuerde zweimal angenommen.
   */
  res.status(200).send("ok");

  try {
    const stufe = await nimmAn(callId, nummer);
    logger.info({ nummer, stufe }, "Anruf angenommen");
  } catch (err) {
    logger.error({ err, nummer }, "Anruf annehmen fehlgeschlagen");
    recordDebugEvent("telefon/annehmen", err);
    await protokolliere({
      richtung: "eingehend",
      nummer,
      ergebnis: "fehlgeschlagen",
      detail: err instanceof Error ? err.message : String(err),
    });
    await weiseAb(callId, "Annehmen fehlgeschlagen");
  }
});

// ── Verwaltung (hinter LUKAS_API_TOKEN) ────────────────────────────────────

const router = Router();

const serialize = (r: typeof telefonNummern.$inferSelect) => ({
  id: r.id,
  nummer: r.nummer,
  name: r.name,
  stufe: r.stufe,
  darfAngerufenWerden: r.darfAngerufenWerden,
  notiz: r.notiz,
  zuletztGesehen: r.zuletztGesehen?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

router.get("/lukas/telefon", async (_req, res) => {
  try {
    const [nummern, anrufe] = await Promise.all([
      db.select().from(telefonNummern).orderBy(desc(telefonNummern.createdAt)),
      letzteAnrufe(30),
    ]);
    res.json({
      nummern: nummern.map(serialize),
      anrufe: anrufe.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      // Damit das Dashboard sagen kann, was noch fehlt, statt still nichts zu tun.
      bereit: {
        webhook: Boolean(process.env.OPENAI_WEBHOOK_SECRET),
        anrufen: Boolean(twilioZugang() && process.env.TWILIO_NUMMER && process.env.OPENAI_PROJECT_ID),
      },
    });
  } catch (err) {
    logger.error({ err }, "Telefonnummern laden fehlgeschlagen");
    res.status(500).json({ error: "Failed to load phone numbers" });
  }
});

/*
 * Twilio-Einrichtung aus dem Dashboard.
 *
 * Dieselben drei Aufrufe wie im Skript, nur ohne Kommandozeile — und ohne dass
 * die Zugangsdaten irgendwo landen, wo sie nicht hingehoeren: der Server hat
 * sie als Umgebungsvariablen ohnehin.
 */
router.get("/lukas/telefon/twilio", async (_req, res) => {
  try {
    res.json(await twilioStand());
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Fehler" });
  }
});

router.post("/lukas/telefon/einrichten", async (req, res) => {
  const nummer = String((req.body ?? {}).nummer ?? "").trim();
  if (!nummer.startsWith("+")) {
    return void res.status(400).json({ error: "Nummer in der Form +49… angeben." });
  }
  try {
    res.json({ schritte: await twilioEinrichten(nummer) });
  } catch (err) {
    logger.error({ err }, "Twilio-Einrichtung fehlgeschlagen");
    res.status(400).json({ error: err instanceof Error ? err.message : "Fehler" });
  }
});

/*
 * Testanruf. Umgeht bewusst die Freigabe-Liste NICHT — wer hier anrufen will,
 * muss die Nummer vorher freigeschaltet haben. Sonst waere das Dashboard ein
 * Weg, die Sperre zu umgehen, die es selbst verwaltet.
 */
/*
 * SMS.
 *
 * Bewusst hier und nicht in einer eigenen Datei: es ist dieselbe Sache wie das
 * Telefon — eine Nummer, ein Kontakt, dieselbe Sperrliste. Wer am Telefon
 * abgewiesen wird, bekommt auch keine SMS; das prueft lib/sms.ts.
 */
router.get("/lukas/sms", async (_req, res) => {
  try {
    const zeilen = await letzteSms(50);
    res.json({
      bereit: zugangVorhanden(),
      nachrichten: zeilen.map((z) => ({ ...z, createdAt: z.createdAt.toISOString() })),
    });
  } catch (err) {
    logger.error({ err }, "SMS-Liste konnte nicht gelesen werden");
    res.status(500).json({ error: "SMS konnten nicht geladen werden" });
  }
});

router.post("/lukas/sms", async (req, res) => {
  try {
    const ergebnis = await sendeSms({
      an: String(req.body?.an ?? ""),
      text: String(req.body?.text ?? ""),
      // Aus dem Dashboard hat Issa selbst getippt — das ist seine eigene
      // Nachricht, keine von Lukas formulierte.
      quelle: "dashboard",
    });
    res.status(ergebnis.ok ? 200 : 502).json(ergebnis);
  } catch (err) {
    const grund = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "SMS aus dem Dashboard fehlgeschlagen");
    res.status(400).json({ error: grund });
  }
});

router.post("/lukas/telefon/testanruf", async (req, res) => {
  const nummer = String((req.body ?? {}).nummer ?? "").trim();
  if (!nummer) return void res.status(400).json({ error: "Nummer fehlt." });
  try {
    res.json({ meldung: await starteAnruf(nummer, "Testanruf aus dem Dashboard") });
  } catch (err) {
    logger.error({ err }, "Testanruf fehlgeschlagen");
    res.status(400).json({ error: err instanceof Error ? err.message : "Fehler" });
  }
});

const NummerBody = z.object({
  nummer: z.string().min(4).max(32),
  name: z.string().max(80).optional(),
  stufe: z.enum(["privat", "oeffentlich", "gesperrt"]).optional(),
  darfAngerufenWerden: z.boolean().optional(),
  notiz: z.string().max(300).optional(),
});

router.post("/lukas/telefon", async (req, res) => {
  const parsed = NummerBody.safeParse(req.body ?? {});
  if (!parsed.success) return void res.status(400).json({ error: "Nummer ist nötig." });

  const nummer = normalisiere(parsed.data.nummer);
  if (nummer.length < 6) {
    return void res.status(400).json({ error: "Das sieht nicht nach einer Telefonnummer aus." });
  }

  try {
    // Zweimal dieselbe Nummer mit verschiedenen Stufen waere ein Zufallsergebnis.
    const [vorhanden] = await db
      .select()
      .from(telefonNummern)
      .where(eq(telefonNummern.nummer, nummer))
      .limit(1);
    if (vorhanden) {
      return void res.status(409).json({ error: "Diese Nummer steht schon in der Liste." });
    }

    const [row] = await db
      .insert(telefonNummern)
      .values({
        nummer,
        name: parsed.data.name ?? "",
        stufe: parsed.data.stufe ?? "oeffentlich",
        darfAngerufenWerden: parsed.data.darfAngerufenWerden ?? false,
        notiz: parsed.data.notiz ?? "",
      })
      .returning();
    res.status(201).json(serialize(row));
  } catch (err) {
    logger.error({ err }, "Telefonnummer anlegen fehlgeschlagen");
    res.status(500).json({ error: "Failed to create" });
  }
});

router.patch("/lukas/telefon/:id", async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  const parsed = NummerBody.partial().safeParse(req.body ?? {});
  if (!Number.isInteger(id) || !parsed.success) {
    return void res.status(400).json({ error: "Ungültige Eingabe" });
  }
  try {
    const werte: Record<string, unknown> = { ...parsed.data };
    if (typeof parsed.data.nummer === "string") werte.nummer = normalisiere(parsed.data.nummer);
    const [row] = await db
      .update(telefonNummern)
      .set(werte)
      .where(eq(telefonNummern.id, id))
      .returning();
    if (!row) return void res.status(404).json({ error: "Nicht gefunden" });
    res.json(serialize(row));
  } catch (err) {
    logger.error({ err }, "Telefonnummer ändern fehlgeschlagen");
    res.status(500).json({ error: "Failed to update" });
  }
});

router.delete("/lukas/telefon/:id", async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id)) return void res.status(400).json({ error: "Ungültige ID" });
  try {
    await db.delete(telefonNummern).where(eq(telefonNummern.id, id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Telefonnummer löschen fehlgeschlagen");
    res.status(500).json({ error: "Failed to delete" });
  }
});

export default router;
