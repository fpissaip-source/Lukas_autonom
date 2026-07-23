import { db } from "@workspace/db";
import { memoriesTable, goalsTable, diaryTable } from "@workspace/db";
import { eq, desc, gte } from "drizzle-orm";
import { LUKAS_SYSTEM_PROMPT } from "./lukas-soul";
import { getLukasStatus, DEFAULT_STATUS } from "./lukas-status";
import { getEmotionalContext, getCharacterContext } from "./emotion-engine";
import { logger } from "./logger";

// Lukas' volles privates System-Prompt (Erinnerungen, Ziele, Tagebuch, Emotion,
// Charakter). Wird vom Dashboard-Text-Chat (routes/anthropic.ts) UND vom
// privaten Realtime-Sprachkanal (routes/lukas.ts) genutzt — beide sollen
// denselben vollen Kontext haben, im Gegensatz zum oeffentlichen Widget
// (routes/public.ts, nur "public"-Erinnerungen).
export async function buildSystemPrompt(userQuery?: string): Promise<string> {
  // Alle unabhängigen DB-/Kontext-Abfragen gleichzeitig starten statt
  // nacheinander zu warten — spart bei ~7 Roundtrips spürbar Zeit, bevor
  // der eigentliche (viel teurere) Modell-Aufruf überhaupt losgeht.
  const [
    statusRow,
    importantMemories,
    recentMemories,
    activeGoals,
    recentDiary,
    emotionalContext,
    characterContext,
    relevantContext,
  ] = await Promise.all([
    getLukasStatus(),
    db
      .select()
      .from(memoriesTable)
      .where(gte(memoriesTable.importance, 7))
      .orderBy(desc(memoriesTable.importance), desc(memoriesTable.createdAt))
      .limit(10),
    db.select().from(memoriesTable).orderBy(desc(memoriesTable.createdAt)).limit(10),
    db.select().from(goalsTable).where(eq(goalsTable.status, "active")).limit(5),
    db.select().from(diaryTable).orderBy(desc(diaryTable.createdAt)).limit(2),
    getEmotionalContext(),
    getCharacterContext(),
    userQuery
      ? import("./memory-retrieval")
          .then(({ memoryContextFor }) => memoryContextFor(userQuery, 6))
          .then((block) =>
            block
              ? `\n\nRELEVANTES WISSEN ZU DIESER NACHRICHT (mit Evidenz-Status — unbelegtes NIE als Fakt behandeln):\n${block}`
              : "",
          )
          .catch((err) => {
            logger.warn({ err }, "Memory-Retrieval fehlgeschlagen");
            return "";
          })
      : Promise.resolve(""),
  ]);

  const status = statusRow ?? { ...DEFAULT_STATUS, updatedAt: new Date() };

  // Wichtige Erinnerungen (importance ≥ 7) UND die neuesten — nicht nur die
  // neuesten, sonst fallen alte wichtige Erinnerungen aus dem Kontext.
  const seen = new Set<number>();
  const memories = [...importantMemories, ...recentMemories].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  const memoryContext = memories.length > 0
    ? `\n\nDEINE ERINNERUNGEN (wichtigste und neueste):\n${memories
        .map((m) => `- [${m.category}|${m.importance}] ${m.content}`)
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

DEIN AKTUELLER GEFÜHLSZUSTAND:
${emotionalContext}
Obsession: ${status.obsession}
${characterContext ? `\n${characterContext}` : ""}
${memoryContext}${goalsContext}${diaryContext}${relevantContext}`;
}
