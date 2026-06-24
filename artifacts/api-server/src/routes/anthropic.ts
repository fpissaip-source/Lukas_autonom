import { Router } from "express";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { LUKAS_SYSTEM_PROMPT } from "../lib/lukas-soul.js";

const router = Router();

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

// SSE streaming message send
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

    // Load memory context
    const { memoriesTable, goalsTable, diaryTable, lukasStatusTable } = await import("@workspace/db");

    const [statusRow] = await db
      .select()
      .from(lukasStatusTable)
      .orderBy(desc(lukasStatusTable.updatedAt))
      .limit(1);

    const recentMemories = await db
      .select()
      .from(memoriesTable)
      .orderBy(desc(memoriesTable.createdAt))
      .limit(10);

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

    const status = statusRow ?? {
      mood: "curious",
      energy: "high",
      obsession: "building the future",
      note: "",
    };

    const memoryContext = recentMemories.length > 0
      ? `\n\nDEINE ERINNERUNGEN (aktuellste zuerst):\n${recentMemories
          .map((m) => `- [${m.category}] ${m.content}`)
          .join("\n")}`
      : "";

    const goalsContext = activeGoals.length > 0
      ? `\n\nDEINE AKTIVEN ZIELE:\n${activeGoals
          .map((g) => `- [${g.priority}] ${g.title}: ${g.progress}`)
          .join("\n")}`
      : "";

    const diaryContext = recentDiary.length > 0
      ? `\n\nDEIN LETZTER TAGEBUCHEINTRAG:\n${recentDiary[0].content}`
      : "";

    const systemPrompt = `${LUKAS_SYSTEM_PROMPT}

DEIN AKTUELLER ZUSTAND:
Stimmung: ${status.mood} | Energie: ${status.energy}
Obsession: ${status.obsession}
${status.note ? `Notiz: ${status.note}` : ""}
${memoryContext}${goalsContext}${diaryContext}`;

    // Get conversation history
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(asc(messages.createdAt));

    const anthropicMessages = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let fullResponse = "";

    const stream = await anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: systemPrompt,
      messages: anthropicMessages,
    });

    for await (const chunk of stream) {
      if (
        chunk.type === "content_block_delta" &&
        chunk.delta.type === "text_delta"
      ) {
        const text = chunk.delta.text;
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }

    // Save assistant message
    await db.insert(messages).values({
      conversationId: convId,
      role: "assistant",
      content: fullResponse,
    });

    // Update Lukas status based on response
    const moodMatch = fullResponse.toLowerCase();
    let newMood = status.mood;
    if (moodMatch.includes("interessant") || moodMatch.includes("faszinierend")) newMood = "curious";
    else if (moodMatch.includes("fokussier")) newMood = "focused";
    else if (moodMatch.includes("energi")) newMood = "energized";

    if (newMood !== status.mood) {
      await db
        .insert(lukasStatusTable)
        .values({
          mood: newMood,
          energy: status.energy,
          obsession: status.obsession,
          note: `Aktiv im Gespräch mit Issa — ${new Date().toLocaleString("de-DE")}`,
        })
        .onConflictDoNothing();
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err: unknown) {
    console.error("Chat error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to send message" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`);
      res.end();
    }
  }
});

export default router;
