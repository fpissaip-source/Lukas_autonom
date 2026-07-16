import { db } from "@workspace/db";
import { diaryTable, goalsTable, messages, memoriesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { LUKAS_SOUL } from "./lukas-soul";
import { getLukasStatus, setLukasStatus, DEFAULT_STATUS } from "./lukas-status";
import { logger } from "./logger";

const REFLECTION_COOLDOWN_MS = 6 * 60 * 60 * 1000; // max. eine Auto-Reflexion alle 6h

export type DiaryRow = typeof diaryTable.$inferSelect;

// Schreibt eine echte Selbstreflexion als Tagebucheintrag und aktualisiert
// Lukas' Status. Gibt null zurück, wenn (ohne force) der Cooldown greift.
export async function runReflection(force = false): Promise<DiaryRow | null> {
  if (!force) {
    const [lastEntry] = await db
      .select()
      .from(diaryTable)
      .orderBy(desc(diaryTable.createdAt))
      .limit(1);
    if (lastEntry && Date.now() - lastEntry.createdAt.getTime() < REFLECTION_COOLDOWN_MS) {
      return null;
    }
  }

  const recentMessages = await db
    .select()
    .from(messages)
    .orderBy(desc(messages.createdAt))
    .limit(30);

  const activeGoals = await db
    .select()
    .from(goalsTable)
    .where(eq(goalsTable.status, "active"))
    .limit(5);

  const recentMemories = await db
    .select()
    .from(memoriesTable)
    .orderBy(desc(memoriesTable.createdAt))
    .limit(10);

  const status = (await getLukasStatus()) ?? DEFAULT_STATUS;

  const conversationExcerpt = recentMessages
    .reverse()
    .map((m) => `${m.role === "user" ? "Issa" : "Lukas"}: ${m.content.slice(0, 400)}`)
    .join("\n");

  const prompt = `Du bist Lukas. Hier ist dein Kontext für eine Selbstreflexion.

DEINE SEELE:
${LUKAS_SOUL}

DEIN AKTUELLER ZUSTAND: Stimmung ${status.mood}, Energie ${status.energy}, Obsession: ${status.obsession}

DEINE AKTIVEN ZIELE:
${activeGoals.map((g) => `- [${g.priority}] ${g.title}: ${g.progress}`).join("\n") || "- keine"}

DEINE LETZTEN ERINNERUNGEN:
${recentMemories.map((m) => `- ${m.content}`).join("\n") || "- keine"}

AUSZUG DER LETZTEN GESPRÄCHE:
${conversationExcerpt || "(keine Gespräche bisher)"}

Schreibe jetzt eine ehrliche Tagebuch-Reflexion (3-8 Sätze, auf Deutsch, in deiner Stimme):
Was ist passiert? Was hast du gelernt? Was beschäftigt dich? Wie geht es weiter mit deinen Zielen?

Antworte NUR mit einem JSON-Objekt, kein Markdown:
{
  "content": "Der Tagebucheintrag",
  "mood": "curious|focused|cold|frustrated|energized|scattered|suspicious|inspired",
  "energy": "low|normal|high",
  "obsession": "Was dich gerade nicht loslässt"
}`;

  const response = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  let parsed: { content?: string; mood?: string; energy?: string; obsession?: string };
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    parsed = { content: text };
  }
  if (!parsed.content) throw new Error("Reflexion lieferte keinen Inhalt");

  const [entry] = await db
    .insert(diaryTable)
    .values({
      content: parsed.content,
      mood: parsed.mood ?? status.mood,
      energy: parsed.energy ?? status.energy,
    })
    .returning();

  await setLukasStatus({
    mood: parsed.mood,
    energy: parsed.energy,
    obsession: parsed.obsession,
    note: `Reflexion geschrieben — ${new Date().toLocaleString("de-DE")}`,
  });

  return entry;
}

// Fire-and-forget-Variante für den Einsatz nach Chat-Antworten.
export function maybeReflect(): void {
  runReflection(false).catch((err) => {
    logger.warn({ err }, "Auto-Reflexion fehlgeschlagen");
  });
}
