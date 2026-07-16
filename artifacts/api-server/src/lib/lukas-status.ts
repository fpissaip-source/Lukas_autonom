import { db } from "@workspace/db";
import { lukasStatusTable, type LukasStatusRow } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

export const DEFAULT_STATUS = {
  mood: "curious",
  energy: "high",
  obsession: "building the future",
  note: "Erste Session — alles frisch geladen.",
};

export async function getLukasStatus(): Promise<LukasStatusRow | null> {
  const [row] = await db
    .select()
    .from(lukasStatusTable)
    .orderBy(desc(lukasStatusTable.updatedAt))
    .limit(1);
  return row ?? null;
}

// The status is conceptually a single row — update it in place instead of
// appending a new row per change (the table has no unique constraint).
export async function setLukasStatus(input: {
  mood?: string;
  energy?: string;
  obsession?: string;
  note?: string;
}): Promise<LukasStatusRow> {
  const current = await getLukasStatus();
  if (current) {
    const [row] = await db
      .update(lukasStatusTable)
      .set({
        mood: input.mood ?? current.mood,
        energy: input.energy ?? current.energy,
        obsession: input.obsession ?? current.obsession,
        note: input.note ?? current.note,
        updatedAt: new Date(),
      })
      .where(eq(lukasStatusTable.id, current.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(lukasStatusTable)
    .values({
      mood: input.mood ?? DEFAULT_STATUS.mood,
      energy: input.energy ?? DEFAULT_STATUS.energy,
      obsession: input.obsession ?? DEFAULT_STATUS.obsession,
      note: input.note ?? DEFAULT_STATUS.note,
    })
    .returning();
  return row;
}
