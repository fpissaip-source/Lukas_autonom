import { Router } from "express";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@workspace/db";
import {
  conversations,
  messages,
  memoriesTable,
  goalsTable,
  diaryTable,
} from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { LUKAS_SYSTEM_PROMPT } from "../lib/lukas-soul";
import { LUKAS_TOOLS, executeLukasTool } from "../lib/lukas-tools";
import { getLukasStatus, DEFAULT_STATUS } from "../lib/lukas-status";
import { maybeReflect } from "../lib/reflection";
import { logger } from "../lib/logger";

const router = Router();

const CHAT_MODEL = "claude-opus-4-8";
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

async function buildSystemPrompt(): Promise<string> {
  const status = (await getLukasStatus()) ?? { ...DEFAULT_STATUS, updatedAt: new Date() };

  const recentMemories = await db
    .select()
    .from(memoriesTable)
    .orderBy(desc(memoriesTable.createdAt))
    .limit(15);

  const activeGoals = await db
    .select()
    .from(goalsTable)
    .where(eq(goalsTable.status, "active"))
    .limit(5);

  const recentDiary = await db
    .select()
    .from(diaryTable)
    .orderBy(desc(diaryTable.createdAt))
    .limit(2);

  const memoryContext = recentMemories.length > 0
    ? `\n\nDEINE ERINNERUNGEN (aktuellste zuerst):\n${recentMemories
        .map((m) => `- [${m.category}] ${m.content}`)
        .join("\n")}`
    : "";

  const goalsContext = activeGoals.length > 0
    ? `\n\nDEINE AKTIVEN ZIELE:\n${activeGoals
        .map((g) => `- #${g.id} [${g.priority}] ${g.title}: ${g.progress}`)
        .join("\n")}`
    : "";

  const diaryContext = recentDiary.length > 0
    ? `\n\nDEIN LETZTER TAGEBUCHEINTRAG:\n${recentDiary[0].content}`
    : "";

  return `${LUKAS_SYSTEM_PROMPT}

DEIN AKTUELLER ZUSTAND:
Stimmung: ${status.mood} | Energie: ${status.energy}
Obsession: ${status.obsession}
${status.note ? `Notiz: ${status.note}` : ""}
${memoryContext}${goalsContext}${diaryContext}`;
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
    await db.insert(messages).values({ conversationId: convId, role: "user", content });

    const systemPrompt = await buildSystemPrompt();

    // Conversation history from DB (text only)
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(asc(messages.createdAt));

    const convo: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const textPieces: string[] = [];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const stream = anthropic.messages.stream({
        model: CHAT_MODEL,
        max_tokens: 8192,
        system: systemPrompt,
        tools: LUKAS_TOOLS,
        messages: convo,
      });

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          textPieces.push(chunk.delta.text);
          res.write(`data: ${JSON.stringify({ content: chunk.delta.text })}\n\n`);
        } else if (
          chunk.type === "content_block_start" &&
          chunk.content_block.type === "tool_use"
        ) {
          // Let the UI show what Lukas is doing
          res.write(`data: ${JSON.stringify({ tool: chunk.content_block.name })}\n\n`);
        }
      }

      const finalMessage = await stream.finalMessage();

      if (finalMessage.stop_reason !== "tool_use") break;

      const toolUses = finalMessage.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      convo.push({ role: "assistant", content: finalMessage.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        try {
          const result = await executeLukasTool(
            toolUse.name,
            (toolUse.input ?? {}) as Record<string, unknown>,
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result,
          });
        } catch (err) {
          logger.warn({ err, tool: toolUse.name }, "Lukas tool failed");
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Fehler: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      }

      convo.push({ role: "user", content: toolResults });
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
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to send message" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`);
      res.end();
    }
  }
});

export default router;
