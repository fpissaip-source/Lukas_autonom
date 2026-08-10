import { Router } from "express";
import type OpenAI from "openai";
import { db } from "@workspace/db";
import { conversations, messages, attachments as attachmentsTable } from "@workspace/db";
import { eq, desc, asc, and, isNull } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai";
import { LUKAS_TOOLS, executeLukasTool } from "../lib/lukas-tools";
import { recordEmotion } from "../lib/emotion-engine";
import { maybeReflect } from "../lib/reflection";
import { buildSystemPrompt } from "../lib/system-prompt";
import { logger } from "../lib/logger";
import { recordDebugEvent } from "../lib/debug-log";
import { attachmentKind } from "./attachments";
import { extractVideoFrames } from "../lib/video-frames";
import { rememberUserMessage } from "../lib/conversation-memory";

const router = Router();

const CHAT_MODEL = process.env.LUKAS_CORE_MODEL ?? "gpt-4o";
const MAX_TOOL_ITERATIONS = 8;

// ── CONVERSATIONS ──────────────────────────────────────────────────────────
router.get("/anthropic/conversations", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.createdAt));
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

// ── MESSAGES ───────────────────────────────────────────────────────────────
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

type PendingToolCall = { id: string; name: string; arguments: string };

type AttachmentRow = typeof attachmentsTable.$inferSelect;

/*
 * Uebersetzt hochgeladene Dateien in das, was das Modell tatsaechlich lesen
 * kann. Wichtig und bewusst unterschiedlich je Typ:
 *  - Bilder  -> image_url mit Base64-Data-URL (echtes Sehen, gpt-4o Vision)
 *  - PDF     -> file-Content-Part mit file_data (das Modell liest das Dokument)
 *  - Text    -> Inhalt direkt als Text eingebettet
 *  - Video   -> Chat Completions hat KEINEN Video-Input. Statt so zu tun, als
 *               koennte Lukas das Video sehen, bekommt er einen ehrlichen
 *               Hinweis. Sonst wuerde er ueber Inhalte halluzinieren, die er
 *               nie gesehen hat.
 */
async function buildAttachmentParts(
  rows: AttachmentRow[],
  text: string,
): Promise<OpenAI.Chat.Completions.ChatCompletionContentPart[]> {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  if (text.trim()) parts.push({ type: "text", text });

  for (const row of rows) {
    const kind = attachmentKind(row.mimeType, row.filename);
    if (kind === "image") {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${row.mimeType};base64,${row.data}` },
      });
    } else if (kind === "pdf") {
      parts.push({
        type: "file",
        file: { filename: row.filename, file_data: `data:${row.mimeType};base64,${row.data}` },
      });
    } else if (kind === "text") {
      const decoded = Buffer.from(row.data, "base64").toString("utf-8");
      const clipped =
        decoded.length > 30000 ? decoded.slice(0, 30000) + "\n\n[... gekürzt]" : decoded;
      parts.push({ type: "text", text: `Datei "${row.filename}":\n\n${clipped}` });
    } else if (kind === "video") {
      // Video wird in Einzelbilder zerlegt und als Bildfolge geschickt — die
      // API kann kein Video, aber sehr wohl Bilder.
      const extracted = await extractVideoFrames(row.data, row.filename);
      if (extracted.ok) {
        const dauer = extracted.durationSeconds
          ? `${extracted.durationSeconds.toFixed(1)} Sekunden`
          : "unbekannter Länge";
        parts.push({
          type: "text",
          text:
            `[Video "${row.filename}" (${dauer}): daraus ${extracted.frames.length} gleichmäßig ` +
            `verteilte Standbilder in zeitlicher Reihenfolge. Du siehst KEIN durchgehendes Video ` +
            `und hörst KEINEN Ton — zwischen zwei Bildern kann etwas passieren, das du nicht ` +
            `siehst. Beschreibe, was tatsächlich zu sehen ist, und rate nichts dazu.]`,
        });
        for (const frame of extracted.frames) {
          parts.push({
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${frame}` },
          });
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

// SSE streaming message send with a real agentic tool loop
router.post("/anthropic/conversations/:id/messages", async (req, res) => {
  try {
    const convId = parseInt(req.params.id);
    const { content } = req.body;
    if (!content) return void res.status(400).json({ error: "content required" });

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId));
    if (!conv) return void res.status(404).json({ error: "Conversation not found" });

    // Save user message
    const [userMessage] = await db
      .insert(messages)
      .values({ conversationId: convId, role: "user", content })
      .returning();

    // Zusaetzlich ins Langzeitgedaechtnis (Issas Wunsch: alles behalten).
    // Bewusst nicht awaited — das Gespraech soll nicht darauf warten.
    rememberUserMessage(String(content), "dashboard");

    // Noch nicht zugeordnete Anhaenge gehoeren zu genau dieser Nachricht: sie
    // wurden hochgeladen, waehrend Issa den Text getippt hat.
    const pendingAttachments = await db
      .update(attachmentsTable)
      .set({ messageId: userMessage.id })
      .where(
        and(
          eq(attachmentsTable.conversationId, convId),
          isNull(attachmentsTable.messageId),
        ),
      )
      .returning();

    const systemPrompt = await buildSystemPrompt(String(content).slice(0, 500));

    // Conversation history from DB (text only)
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(asc(messages.createdAt));

    const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    // Anhaenge an die letzte (= gerade gespeicherte) Nutzernachricht haengen.
    if (pendingAttachments.length > 0) {
      const parts = await buildAttachmentParts(pendingAttachments, String(content));
      convo[convo.length - 1] = { role: "user", content: parts };
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const textPieces: string[] = [];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const stream = await openai.chat.completions.create({
        model: CHAT_MODEL,
        max_completion_tokens: 8192,
        tools: LUKAS_TOOLS,
        messages: convo,
        stream: true,
      });

      // OpenAI streamt Tool-Call-Argumente als JSON-Fragmente pro Index —
      // hier über die Chunks hinweg pro Tool-Call akkumulieren.
      const toolCallsByIndex = new Map<number, PendingToolCall>();
      let finishReason: string | null = null;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta;

        if (delta?.content) {
          textPieces.push(delta.content);
          res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            let entry = toolCallsByIndex.get(tc.index);
            if (!entry) {
              entry = { id: tc.id ?? "", name: tc.function?.name ?? "", arguments: "" };
              toolCallsByIndex.set(tc.index, entry);
              if (entry.name) {
                // Let the UI show what Lukas is doing
                res.write(`data: ${JSON.stringify({ tool: entry.name })}\n\n`);
              }
            }
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
            if (tc.function?.arguments) entry.arguments += tc.function.arguments;
          }
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;
      }

      if (finishReason !== "tool_calls" || toolCallsByIndex.size === 0) break;

      const toolCalls = Array.from(toolCallsByIndex.values());

      convo.push({
        role: "assistant",
        content: null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const toolCall of toolCalls) {
        let input: Record<string, unknown> = {};
        try {
          input = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
        } catch {
          // Kaputtes JSON vom Modell — leere Args, das Tool meldet fehlende Felder selbst.
        }
        try {
          const result = await executeLukasTool(toolCall.name, input, {
            rawUserMessage: String(content),
            conversationId: convId,
          });
          convo.push({ role: "tool", tool_call_id: toolCall.id, content: result });
        } catch (err) {
          logger.warn({ err, tool: toolCall.name }, "Lukas tool failed");
          convo.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Fehler: ${err instanceof Error ? err.message : String(err)}`,
          });
          // Scheitern nervt — leicht, aber echt (nicht für das feel-Tool selbst).
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

      // Paragraph break between tool-separated text segments
      if (textPieces.length > 0 && !textPieces[textPieces.length - 1].endsWith("\n")) {
        textPieces.push("\n\n");
      }
    }

    const fullResponse = textPieces.join("").trim();

    // Save assistant message
    if (fullResponse) {
      await db.insert(messages).values({
        conversationId: convId,
        role: "assistant",
        content: fullResponse,
      });
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

    // Nach dem Gespräch: ggf. autonome Tagebuch-Reflexion (max. alle 6h)
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
