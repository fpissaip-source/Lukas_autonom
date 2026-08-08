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
  isAllowedSender,
  whatsappConfigured,
  verifyWhatsAppSignature,
} from "../lib/whatsapp";
import { logger } from "../lib/logger";
import { recordDebugEvent } from "../lib/debug-log";

const router = Router();
const CONVERSATION_TITLE = "WhatsApp";

/** Alle WhatsApp-Nachrichten laufen in einem durchgehenden Thread. */
async function getWhatsAppConversation(): Promise<number> {
  const [existing] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.title, CONVERSATION_TITLE))
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(conversations)
    .values({ title: CONVERSATION_TITLE })
    .returning();
  return created.id;
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
          if (!isAllowedSender(from)) {
            logger.warn({ from }, "WhatsApp-Nachricht von nicht freigegebener Nummer ignoriert");
            recordDebugEvent(
              "whatsapp/webhook",
              `Nachricht von ${from} ignoriert — Nummer steht nicht in WHATSAPP_ALLOWED_NUMBERS`,
            );
            continue;
          }

          let text: string = msg.text?.body ?? "";
          const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

          const mediaId = msg.image?.id ?? msg.document?.id;
          if (mediaId) {
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
          } else if (msg.audio || msg.voice) {
            text =
              (text || "") +
              "\n[Sprachnachricht erhalten — du kannst Audio über diesen Kanal nicht abhören. " +
              "Sag das ehrlich und bitte um Text.]";
          }

          if (!text.trim() && parts.length === 0) continue;

          const convId = await getWhatsAppConversation();
          await db.insert(messages).values({
            conversationId: convId,
            role: "user",
            content: text || "(Bild)",
          });
          rememberUserMessage(text || "(Bild via WhatsApp)", "whatsapp");

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

          const answer = await runLukasTurn({
            history,
            userText: text,
            conversationId: convId,
          });

          const reply = answer || "Da ist bei mir gerade nichts rausgekommen — frag nochmal?";
          await db.insert(messages).values({
            conversationId: convId,
            role: "assistant",
            content: reply,
          });
          rememberAssistantMessage(reply, "whatsapp");
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
