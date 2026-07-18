import { Router } from "express";
import { db } from "@workspace/db";
import {
  memoriesTable,
  goalsTable,
  diaryTable,
  mediaJobsTable,
  emotionsTable,
  claimsTable,
} from "@workspace/db";
import { eq, desc, ilike, and } from "drizzle-orm";
import { getLukasStatus, DEFAULT_STATUS } from "../lib/lukas-status";
import { getCharacter } from "../lib/emotion-engine";
import { runReflection } from "../lib/reflection";

const router = Router();

// ── STATUS ─────────────────────────────────────────────────────────────────
router.get("/lukas/status", async (req, res) => {
  try {
    const statusRow = await getLukasStatus();

    const memoriesCount = await db.$count(memoriesTable);
    const activeGoals = await db
      .select()
      .from(goalsTable)
      .where(eq(goalsTable.status, "active"));

    const status = statusRow ?? { ...DEFAULT_STATUS, updatedAt: new Date() };

    res.json({
      mood: status.mood,
      energy: status.energy,
      obsession: status.obsession,
      note: status.note,
      lastActive: status.updatedAt.toISOString(),
      activeGoalsCount: activeGoals.length,
      memoriesCount: Number(memoriesCount),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get status" });
  }
});

// ── DASHBOARD ──────────────────────────────────────────────────────────────
router.get("/lukas/dashboard", async (req, res) => {
  try {
    const statusRow = await getLukasStatus();

    const memoriesCount = await db.$count(memoriesTable);
    const activeGoals = await db
      .select()
      .from(goalsTable)
      .where(eq(goalsTable.status, "active"))
      .orderBy(desc(goalsTable.createdAt))
      .limit(5);

    const recentDiary = await db
      .select()
      .from(diaryTable)
      .orderBy(desc(diaryTable.createdAt))
      .limit(3);

    const recentMemories = await db
      .select()
      .from(memoriesTable)
      .orderBy(desc(memoriesTable.createdAt))
      .limit(5);

    const mediaJobs = await db
      .select()
      .from(mediaJobsTable)
      .orderBy(desc(mediaJobsTable.createdAt))
      .limit(5);

    const recentEmotions = await db
      .select()
      .from(emotionsTable)
      .orderBy(desc(emotionsTable.createdAt))
      .limit(10);

    const character = await getCharacter();

    const status = statusRow ?? { ...DEFAULT_STATUS, updatedAt: new Date() };

    res.json({
      status: {
        mood: status.mood,
        energy: status.energy,
        obsession: status.obsession,
        note: status.note,
        lastActive: status.updatedAt.toISOString(),
        activeGoalsCount: activeGoals.length,
        memoriesCount: Number(memoriesCount),
      },
      recentDiary: recentDiary.map((d) => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
      })),
      activeGoals: activeGoals.map((g) => ({
        ...g,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      })),
      recentMemories: recentMemories.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
      mediaJobs: mediaJobs.map((j) => ({
        ...j,
        createdAt: j.createdAt.toISOString(),
        updatedAt: j.updatedAt.toISOString(),
      })),
      recentEmotions: recentEmotions.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
      character: character
        ? {
            traits: character.traits,
            selfImage: character.selfImage,
            updatedAt: character.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get dashboard" });
  }
});

// ── EMOTIONS ───────────────────────────────────────────────────────────────
router.get("/lukas/emotions", async (req, res) => {
  try {
    const { limit = "20" } = req.query as Record<string, string>;
    const rows = await db
      .select()
      .from(emotionsTable)
      .orderBy(desc(emotionsTable.createdAt))
      .limit(parseInt(limit) || 20);

    res.json(rows.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })));
  } catch (err) {
    res.status(500).json({ error: "Failed to get emotions" });
  }
});

// ── MEMORIES ───────────────────────────────────────────────────────────────
router.get("/lukas/memories", async (req, res) => {
  try {
    const { category, search, limit = "50" } = req.query as Record<string, string>;

    const conditions = [];
    if (category) conditions.push(eq(memoriesTable.category, category));
    if (search) conditions.push(ilike(memoriesTable.content, `%${search}%`));

    const rows = await db
      .select()
      .from(memoriesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(memoriesTable.createdAt))
      .limit(parseInt(limit) || 50);

    res.json(
      rows.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to get memories" });
  }
});

router.post("/lukas/memories", async (req, res) => {
  try {
    const { content, category = "personal", importance = 5, tags = [] } = req.body;
    if (!content) return void res.status(400).json({ error: "content required" });

    const [row] = await db
      .insert(memoriesTable)
      .values({ content, category, importance, tags })
      .returning();

    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Failed to create memory" });
  }
});

router.delete("/lukas/memories/:id", async (req, res) => {
  try {
    await db.delete(memoriesTable).where(eq(memoriesTable.id, parseInt(req.params.id)));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete memory" });
  }
});

// ── GOALS ──────────────────────────────────────────────────────────────────
router.get("/lukas/goals", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(goalsTable)
      .orderBy(desc(goalsTable.createdAt));

    res.json(
      rows.map((g) => ({
        ...g,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to get goals" });
  }
});

router.post("/lukas/goals", async (req, res) => {
  try {
    const { title, description, priority = "medium" } = req.body;
    if (!title || !description)
      return void res.status(400).json({ error: "title and description required" });

    const [row] = await db
      .insert(goalsTable)
      .values({ title, description, priority, status: "active", progress: "just started" })
      .returning();

    res.status(201).json({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to create goal" });
  }
});

router.patch("/lukas/goals/:id", async (req, res) => {
  try {
    const { progress, status, note } = req.body;
    const id = parseInt(req.params.id);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (progress !== undefined) updates.progress = progress;
    if (status !== undefined) updates.status = status;

    const [row] = await db
      .update(goalsTable)
      .set(updates)
      .where(eq(goalsTable.id, id))
      .returning();

    if (!row) return void res.status(404).json({ error: "Goal not found" });

    res.json({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to update goal" });
  }
});

router.delete("/lukas/goals/:id", async (req, res) => {
  try {
    await db.delete(goalsTable).where(eq(goalsTable.id, parseInt(req.params.id)));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete goal" });
  }
});

// ── DIARY ──────────────────────────────────────────────────────────────────
router.get("/lukas/diary", async (req, res) => {
  try {
    const { limit = "20" } = req.query as Record<string, string>;

    const rows = await db
      .select()
      .from(diaryTable)
      .orderBy(desc(diaryTable.createdAt))
      .limit(parseInt(limit) || 20);

    res.json(rows.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })));
  } catch (err) {
    res.status(500).json({ error: "Failed to get diary" });
  }
});

router.post("/lukas/diary", async (req, res) => {
  try {
    const { content, mood = "neutral", energy = "normal" } = req.body;
    if (!content) return void res.status(400).json({ error: "content required" });

    const [row] = await db
      .insert(diaryTable)
      .values({ content, mood, energy })
      .returning();

    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Failed to create diary entry" });
  }
});

// ── CLAIMS ─────────────────────────────────────────────────────────────────
router.get("/lukas/claims", async (req, res) => {
  try {
    const { limit = "50" } = req.query as Record<string, string>;
    const rows = await db
      .select()
      .from(claimsTable)
      .orderBy(desc(claimsTable.observedAt))
      .limit(parseInt(limit) || 50);

    res.json(
      rows.map((c) => ({
        id: c.id,
        subject: c.subject,
        predicate: c.predicate,
        value: c.value,
        confidence: c.confidence,
        evidenceLevel: c.evidenceLevel,
        sourceType: c.sourceType,
        status: c.status,
        corroborations: c.corroborations,
        observedAt: c.observedAt.toISOString(),
      })),
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to get claims" });
  }
});

// ── REFLECT ────────────────────────────────────────────────────────────────
// Löst eine echte Selbstreflexion aus: Lukas schreibt einen Tagebucheintrag
// über die letzten Gespräche/Ziele und aktualisiert seinen Status.
router.post("/lukas/reflect", async (req, res) => {
  try {
    const entry = await runReflection(true);
    if (!entry) return void res.status(500).json({ error: "Reflection produced no entry" });
    res.status(201).json({ ...entry, createdAt: entry.createdAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Failed to reflect" });
  }
});

export default router;
