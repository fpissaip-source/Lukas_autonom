import { Router } from "express";
import type OpenAI from "openai";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai";
import { LUKAS_TOOLS, executeLukasTool } from "../lib/lukas-tools";
import { recordEmotion } from "../lib/emotion-engine";
import { maybeReflect } from "../lib/reflection";
import { buildSystemPrompt } from "../lib/system-prompt";
import { logger } from "../lib/logger";
import { recordDebugEvent } from "../lib/debug-log";

const router = Router();

const CHAT_MODEL = process.env.LUKAS_CORE_MODEL ?? "gpt-5.6-sol";
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
    await db.insert(messages).values({ conversationId: convId, role: "user", content });

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
