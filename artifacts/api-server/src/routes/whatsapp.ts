import { Router } from "express";
import type OpenAI from "openai";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";
import { runLukasTurn } from "../lib/lukas-brain";
import { rememberAssistantMessage, rememberUserMessage } from "../lib/conversation-memory";
import {
  sendWhatsAppMessage,
  downloadWhatsAppMedia,
  senderRole,
  whatsappConfigured,
  verifyWhatsAppSignature,
} from "../lib/whatsapp";
import { buildPublicSystemPrompt } from "../lib/public-prompt";
import { logger } from "../lib/logger";
import { recordDebugEvent } from "../lib/debug-log";

const router = Router();
const OWNER_TITLE = "WhatsApp";

/*
 * Ein eigener Thread pro Nummer.
 *
 * Issas Gespraech heisst weiterhin schlicht "WhatsApp" (damit der bestehende
 * Verlauf erhalten bleibt), jede fremde Nummer bekommt einen eigenen.
 *
 * Das ist keine Kosmetik, sondern die wichtigste Grenze hier: laegen fremde
 * Nachrichten in Issas Thread, wuerden sie beim naechsten Mal als Kontext in
 * seinen privaten Lukas zurueckgespielt — mit allen Werkzeugen. Ein Fremder
 * koennte dort also Anweisungen hinterlegen, die spaeter mit Issas Rechten
 * ausgefuehrt werden. Getrennte Threads schneiden diesen Weg ab.
 */
async function getConversationFor(role: "owner" | "guest", from: string): Promise<number> {
  const title = role === "owner" ? OWNER_TITLE : `WhatsApp Gast ${from}`;
  const [existing] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.title, title))
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(conversations).values({ title }).returning();
  return created.id;
}

/*
 * Einfache Bremse fuer fremde Nummern.
 *
 * Die Nummer ist ab jetzt oeffentlich ansprechbar, und jede Antwort kostet
 * Tokens auf Issas Rechnung. Ohne Bremse koennte eine einzige Person das in
 * kurzer Zeit erheblich treiben. Fuer Issa selbst gilt sie nicht.
 *
 * Im Speicher und bewusst simpel: nach einem Neustart ist die Zaehlung leer.
 * Das ist die harmlose Richtung des Fehlers — bei mehreren Instanzen oder
 * echter Missbrauchslast braucht es etwas Persistentes.
 */
const GUEST_LIMIT = 20;
const GUEST_WINDOW_MS = 60 * 60 * 1000;
const guestBuckets = new Map<string, { count: number; resetAt: number }>();

function guestWithinLimit(from: string): boolean {
  const now = Date.now();
  const bucket = guestBuckets.get(from);
  if (!bucket || bucket.resetAt < now) {
    guestBuckets.set(from, { count: 1, resetAt: now + GUEST_WINDOW_MS });
    return true;
  }
  if (bucket.count >= GUEST_LIMIT) return false;
  bucket.count += 1;
  return true;
}

router.get("/whatsapp/webhook", (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (!verifyToken) {
    recordDebugEvent("whatsapp/webhook", "WHATSAPP_VERIFY_TOKEN ist nicht gesetzt");
    return void res.status(503).send("not configured");
  }
  if (mode === "subscribe" && token === verifyToken) {
    logger.info("WhatsApp-Webhook verifiziert");
    return void res.status(200).send(String(challenge ?? ""));
  }
  res.status(403).send("forbidden");
});

router.post("/whatsapp/webhook", async (req, res) => {
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!verifyWhatsAppSignature(rawBody, req.headers["x-hub-signature-256"] as string | undefined)) {
    recordDebugEvent("whatsapp/webhook", "Ungültige oder fehlende X-Hub-Signature-256 — abgelehnt");
    return void res.status(401).send("invalid signature");
  }

  res.status(200).send("ok");

  try {
    if (!whatsappConfigured()) {
      recordDebugEvent("whatsapp/webhook", "WHATSAPP_TOKEN/PHONE_NUMBER_ID fehlen");
      return;
    }

    const entries = req.body?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        for (const msg of value?.messages ?? []) {
          const from: string = msg.from;
          const role = senderRole(from);

          if (role === "guest" && !guestWithinLimit(from)) {
            logger.warn({ from }, "WhatsApp-Gast über Limit — Nachricht ignoriert");
            continue;
          }

          let text: string = msg.text?.body ?? "";
          const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

          const mediaId = msg.image?.id ?? msg.document?.id;
          if (mediaId && role === "owner") {
            const media = await downloadWhatsAppMedia(mediaId);
            if (media && media.mimeType.startsWith("image/")) {
              const caption = msg.image?.caption ?? msg.document?.caption ?? "";
              if (caption) text = caption;
              parts.push({ type: "text", text: text || "(Bild ohne Text)" });
              parts.push({
                type: "image_url",
                image_url: { url: `data:${media.mimeType};base64,${media.data.toString("base64")}` },
              });
            }
          } else if (mediaId) {
            // Fremde Nummern: nur Text. Bilder herunterzuladen und an ein
            // Vision-Modell zu geben, kostet auf Issas Rechnung und ist ueber
            // eine oeffentlich bekannte Nummer nicht zu begrenzen.
            text =
              (text || "") +
              "\n[Anhang erhalten — über WhatsApp kannst du von Fremden keine Dateien ansehen. " +
              "Sag das freundlich und bitte um Text.]";
          } else if (msg.audio || msg.voice) {
            text =
              (text || "") +
              "\n[Sprachnachricht erhalten — du kannst Audio über diesen Kanal nicht abhören. " +
              "Sag das ehrlich und bitte um Text.]";
          }

          if (!text.trim() && parts.length === 0) continue;

          const convId = await getConversationFor(role, from);
          await db.insert(messages).values({
            conversationId: convId,
            role: "user",
            content: text || "(Bild)",
          });

          /*
           * Nur Issas Nachrichten fliessen ins Langzeitgedaechtnis.
           *
           * Wuerden fremde Nachrichten dort landen, koennte jeder Lukas
           * dauerhaft Dinge "beibringen", die spaeter in Issas privatem
           * Kontext auftauchen und dort wie erinnerte Wahrheit wirken. Das
           * Gespraech selbst bleibt in seinem eigenen Thread erhalten — der
           * Gast wird also nicht vergessen, er kann Lukas nur nicht praegen.
           */
          if (role === "owner") {
            rememberUserMessage(text || "(Bild via WhatsApp)", "whatsapp");
          }

          // Kein eigenes Modellgedaechtnis und kein harter 20-Nachrichten-Cut:
          // derselbe persistierte Thread wird an Lukas weitergegeben. Alte
          // Inhalte bleiben zusaetzlich ueber sein Langzeitgedaechtnis suchbar.
          const rows = await db
            .select()
            .from(messages)
            .where(eq(messages.conversationId, convId))
            .orderBy(asc(messages.createdAt));

          const history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = rows.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));
          if (parts.length > 0) history[history.length - 1] = { role: "user", content: parts };

          /*
           * Hier trennen sich die beiden Welten.
           *
           * owner: der vollstaendige private Lukas mit allen Werkzeugen.
           * guest: oeffentlicher Prompt und ein LEERES Werkzeug-Array. Das
           *        Modell bekommt gar nicht erst die Moeglichkeit, etwas
           *        auszuloesen — die Grenze haengt also nicht daran, dass sich
           *        das Modell an eine Anweisung haelt.
           */
          const answer =
            role === "owner"
              ? await runLukasTurn({ history, userText: text, conversationId: convId })
              : await runLukasTurn({
                  history,
                  userText: text,
                  systemPromptOverride: await buildPublicSystemPrompt("whatsapp"),
                  tools: [],
                });

          const reply = answer || "Da ist bei mir gerade nichts rausgekommen — frag nochmal?";
          await db.insert(messages).values({
            conversationId: convId,
            role: "assistant",
            content: reply,
          });
          if (role === "owner") rememberAssistantMessage(reply, "whatsapp");
          await sendWhatsAppMessage(from, reply);
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "WhatsApp webhook error");
    recordDebugEvent("whatsapp/webhook", err);
  }
});

export default router;
