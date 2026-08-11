import { Router } from "express";
import type OpenAI from "openai";
import { db } from "@workspace/db";
import { conversations, messages, attachments as attachmentsTable } from "@workspace/db";
import { eq, desc, asc, and, isNull } from "drizzle-orm";
import { allLukasTools, executeLukasTool } from "../lib/lukas-tools";
import { recordEmotion } from "../lib/emotion-engine";
import { maybeReflect } from "../lib/reflection";
import { buildSystemPrompt } from "../lib/system-prompt";
import { logger } from "../lib/logger";
import { recordDebugEvent } from "../lib/debug-log";
import { attachmentKind } from "./attachments";
import { extractVideoFrames } from "../lib/video-frames";
import { rememberAssistantMessage, rememberUserMessage } from "../lib/conversation-memory";
import { routeLukasModel } from "../lib/ai/model-router";
import { callLukasModel } from "../lib/ai/model-client";
import { renderLukasVoice } from "../lib/ai/voice-renderer";

const router = Router();
const MAX_TOOL_ITERATIONS = 8;

router.get("/anthropic/conversations", async (_req, res) => {
  try {
    const rows = await db.select().from(conversations).orderBy(desc(conversations.createdAt));
    res.json(rows.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })));
  } catch {
    res.status(500).json({ error: "Failed to get conversations" });
  }
});

router.post("/anthropic/conversations", async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return void res.status(400).json({ error: "title required" });
    const [row] = await db.insert(conversations).values({ title }).returning();
    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch {
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.get("/anthropic/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) return void res.status(404).json({ error: "Conversation not found" });
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));
    res.json({
      ...conv,
      createdAt: conv.createdAt.toISOString(),
      messages: msgs.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    });
  } catch {
    res.status(500).json({ error: "Failed to get conversation" });
  }
});

router.delete("/anthropic/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) return void res.status(404).json({ error: "Conversation not found" });
    await db.delete(conversations).where(eq(conversations.id, id));
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

router.get("/anthropic/conversations/:id/messages", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));
    res.json(msgs.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })));
  } catch {
    res.status(500).json({ error: "Failed to get messages" });
  }
});

type AttachmentRow = typeof attachmentsTable.$inferSelect;

async function buildAttachmentParts(
  rows: AttachmentRow[],
  text: string,
): Promise<OpenAI.Chat.Completions.ChatCompletionContentPart[]> {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  if (text.trim()) parts.push({ type: "text", text });

  for (const row of rows) {
    const kind = attachmentKind(row.mimeType, row.filename);
    if (kind === "image") {
      parts.push({ type: "image_url", image_url: { url: `data:${row.mimeType};base64,${row.data}` } });
    } else if (kind === "pdf") {
      parts.push({
        type: "file",
        file: { filename: row.filename, file_data: `data:${row.mimeType};base64,${row.data}` },
      });
    } else if (kind === "text") {
      const decoded = Buffer.from(row.data, "base64").toString("utf-8");
      const clipped = decoded.length > 30000 ? decoded.slice(0, 30000) + "\n\n[... gekürzt]" : decoded;
      parts.push({ type: "text", text: `Datei "${row.filename}":\n\n${clipped}` });
    } else if (kind === "video") {
      const extracted = await extractVideoFrames(row.data, row.filename);
      if (extracted.ok) {
        const duration = extracted.durationSeconds
          ? `${extracted.durationSeconds.toFixed(1)} Sekunden`
          : "unbekannter Länge";
        parts.push({
          type: "text",
          text:
            `[Video "${row.filename}" (${duration}): daraus ${extracted.frames.length} gleichmäßig ` +
            `verteilte Standbilder in zeitlicher Reihenfolge. Du siehst KEIN durchgehendes Video ` +
            `und hörst KEINEN Ton — zwischen zwei Bildern kann etwas passieren, das du nicht ` +
            `siehst. Beschreibe nur, was tatsächlich zu sehen ist.]`,
        });
        for (const frame of extracted.frames) {
          parts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${frame}` } });
        }
      } else {
        // Der konkrete Grund gehoert hier hin, nicht nur ins Log: sonst steht
        // Lukas im Chat da und spekuliert ueber Dateipfade und Berechtigungen,
        // statt zu sagen, was wirklich kaputt ist.
        parts.push({
          type: "text",
          text:
            `[Video "${row.filename}" (${Math.round(row.sizeBytes / 1024)} KB) wurde angehängt, ` +
            `aber die Einzelbild-Extraktion ist fehlgeschlagen. Grund: ${extracted.reason} ` +
            `Du kannst das Video nicht auswerten — nenne Issa genau diesen Grund, erfinde ` +
            `keinen Inhalt und spekuliere nicht über Dateipfade oder Berechtigungen. ` +
            `Das ist ein Serverproblem, kein Problem mit seiner Datei.]`,
        });
      }
    } else {
      parts.push({
        type: "text",
        text:
          `[Datei "${row.filename}" (${row.mimeType}, ${Math.round(row.sizeBytes / 1024)} KB) ` +
          `wurde angehängt, dieses Format kannst du nicht lesen. Sag das ehrlich.]`,
      });
    }
  }
  return parts;
}

// Der alte /anthropic-Pfad bleibt aus Kompatibilitaetsgruenden bestehen. Intern
// ist er providerunabhaengig. Spezialmodell-Ausgaben werden NICHT direkt an die
// UI gestreamt; sichtbar ist nur die einheitliche Lukas-Ausgabeschicht.
router.post("/anthropic/conversations/:id/messages", async (req, res) => {
  try {
    const convId = parseInt(req.params.id);
    const { content } = req.body;
    if (!content) return void res.status(400).json({ error: "content required" });

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
    if (!conv) return void res.status(404).json({ error: "Conversation not found" });

    const [userMessage] = await db
      .insert(messages)
      .values({ conversationId: convId, role: "user", content })
      .returning();
    rememberUserMessage(String(content), "dashboard");

    const pendingAttachments = await db
      .update(attachmentsTable)
      .set({ messageId: userMessage.id })
      .where(and(eq(attachmentsTable.conversationId, convId), isNull(attachmentsTable.messageId)))
      .returning();

    const systemPrompt = await buildSystemPrompt(String(content).slice(0, 1000));
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(asc(messages.createdAt));

    const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];

    if (pendingAttachments.length > 0) {
      const parts = await buildAttachmentParts(pendingAttachments, String(content));
      convo[convo.length - 1] = { role: "user", content: parts };
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const internalDraftPieces: string[] = [];
    const usedTools: string[] = [];
    const attachmentKinds = pendingAttachments.map((a) => attachmentKind(a.mimeType, a.filename));

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const route = routeLukasModel({
        userText: String(content),
        hasAttachments: pendingAttachments.length > 0,
        attachmentKinds,
        usedTools,
        iteration,
      });

      const result = await callLukasModel({
        route,
        maxTokens: 8192,
        tools: await allLukasTools(),
        messages: convo,
      });

      if (result.content) internalDraftPieces.push(result.content);
      if (result.toolCalls.length === 0) break;

      convo.push({
        role: "assistant",
        content: result.content || null,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const toolCall of result.toolCalls) {
        usedTools.push(toolCall.name);
        res.write(`data: ${JSON.stringify({ tool: toolCall.name })}\n\n`);

        let input: Record<string, unknown> = {};
        try {
          input = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
        } catch {
          // Das Tool meldet fehlende/ungueltige Parameter selbst.
        }

        try {
          const toolResult = await executeLukasTool(toolCall.name, input, {
            rawUserMessage: String(content),
            conversationId: convId,
          });
          convo.push({ role: "tool", tool_call_id: toolCall.id, content: toolResult });
        } catch (err) {
          logger.warn({ err, tool: toolCall.name }, "Lukas tool failed");
          convo.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Fehler: ${err instanceof Error ? err.message : String(err)}`,
          });
          if (toolCall.name !== "feel") {
            recordEmotion({
              emotion: "frustration",
              valence: -0.3,
              intensity: 0.3,
              cause: `Tool ${toolCall.name} ist fehlgeschlagen`,
              source: "tool",
            }).catch(() => {});
          }
        }
      }

      if (
        internalDraftPieces.length > 0 &&
        !internalDraftPieces[internalDraftPieces.length - 1].endsWith("\n")
      ) {
        internalDraftPieces.push("\n\n");
      }
    }

    const draft = internalDraftPieces.join("").trim();
    const fullResponse = draft
      ? await renderLukasVoice({ systemPrompt, conversation: convo, draft })
      : "";

    if (fullResponse) {
      res.write(`data: ${JSON.stringify({ content: fullResponse })}\n\n`);
      await db.insert(messages).values({
        conversationId: convId,
        role: "assistant",
        content: fullResponse,
      });
      rememberAssistantMessage(fullResponse, "dashboard");
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    maybeReflect();
  } catch (err: unknown) {
    logger.error({ err }, "Chat error");
    recordDebugEvent("chat", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to send message" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`);
      res.end();
    }
  }
});

export default router;
