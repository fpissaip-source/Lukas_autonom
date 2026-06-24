import { Router } from "express";
import { db } from "@workspace/db";
import {
  memoriesTable,
  goalsTable,
  diaryTable,
  mediaJobsTable,
  lukasStatusTable,
} from "@workspace/db";
import { eq, desc, ilike, or } from "drizzle-orm";

const router = Router();

// ── STATUS ─────────────────────────────────────────────────────────────────
router.get("/lukas/status", async (req, res) => {
  try {
    const [statusRow] = await db
      .select()
      .from(lukasStatusTable)
      .orderBy(desc(lukasStatusTable.updatedAt))
      .limit(1);

    const memoriesCount = await db.$count(memoriesTable);
    const activeGoals = await db
      .select()
      .from(goalsTable)
      .where(eq(goalsTable.status, "active"));

    const status = statusRow ?? {
      mood: "curious",
      energy: "high",
      obsession: "building the future",
      note: "Erste Session — alles frisch geladen.",
      updatedAt: new Date(),
    };

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
    const [statusRow] = await db
      .select()
      .from(lukasStatusTable)
      .orderBy(desc(lukasStatusTable.updatedAt))
      .limit(1);

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

    const status = statusRow ?? {
      mood: "curious",
      energy: "high",
      obsession: "building the future",
      note: "Erste Session — alles frisch geladen.",
      updatedAt: new Date(),
    };

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
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get dashboard" });
  }
});

// ── MEMORIES ───────────────────────────────────────────────────────────────
router.get("/lukas/memories", async (req, res) => {
  try {
    const { category, search, limit = "50" } = req.query as Record<string, string>;

    let query = db.select().from(memoriesTable);
    const conditions = [];

    if (category) conditions.push(eq(memoriesTable.category, category));
    if (search)
      conditions.push(
        or(
          ilike(memoriesTable.content, `%${search}%`),
        )!
      );

    const rows = await db
      .select()
      .from(memoriesTable)
      .where(conditions.length > 0 ? conditions[0] : undefined)
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

export default router;
