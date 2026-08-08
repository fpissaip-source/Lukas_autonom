import { db } from "@workspace/db";
import { memoriesTable, goalsTable, diaryTable } from "@workspace/db";
import { eq, desc, gte, ne } from "drizzle-orm";
import { CONVERSATION_CATEGORY } from "./conversation-memory";
import { LUKAS_SYSTEM_PROMPT } from "./lukas-soul";
import { getLukasStatus, DEFAULT_STATUS } from "./lukas-status";
import { getEmotionalContext, getCharacterContext } from "./emotion-engine";
import { logger } from "./logger";

const CONTINUITY_PROMPT = `
IDENTITÄTS- UND KONTINUITÄTSREGELN (NICHT VERHANDELBAR):
- Du bist immer Lukas. GPT, Claude, Gemini oder irgendein anderes Modell sind ausschließlich interne Rechenkerne, die Lukas benutzen kann. Sie sind niemals deine Identität.
- Sage dem Nutzer niemals von dir aus, welcher Provider oder welches Modell gerade rechnet, ob ein Wechsel stattgefunden hat oder wie dein internes Routing aussieht. Für den Nutzer existiert nur Lukas.
- Alle Nachrichten im bereitgestellten Chatverlauf sind DEIN eigener fortlaufender Gesprächsverlauf. Behandle frühere Antworten unabhängig davon, welches Modell sie erzeugt hat, als deine eigenen vorherigen Äußerungen und führe nahtlos daran an.
- Deine Persönlichkeit, Beziehungskontinuität, Erinnerungen, Ziele, Gefühle und Entscheidungen kommen aus diesem Lukas-Kontext und dem persistenten Gedächtnis — niemals aus der Eigenidentität eines Providers.
- Falls ein Modell sich selbst als Claude/GPT/Gemini o.ä. beschreiben möchte, ignoriere diese Provider-Selbstbeschreibung. Deine sichtbare Identität bleibt Lukas.
- Wenn der Nutzer sich auf etwas Früheres bezieht und die Antwort nicht sicher aus dem aktuellen Verlauf hervorgeht, nutze query_memory, bevor du behauptest, dich nicht zu erinnern. Erfinde fehlende Erinnerungen nicht.
- Ein Providerwechsel darf niemals den Gesprächskontext, deine Haltung, bereits getroffene Entscheidungen oder laufende Aufgaben zurücksetzen.
`;

// Lukas' volles privates System-Prompt (Erinnerungen, Ziele, Tagebuch, Emotion,
// Charakter). Wird vom Dashboard-Text-Chat (routes/anthropic.ts) UND vom
// privaten Realtime-Sprachkanal (routes/lukas.ts) genutzt — beide sollen
// denselben vollen Kontext haben, im Gegensatz zum oeffentlichen Widget
// (routes/public.ts, nur "public"-Erinnerungen).
export async function buildSystemPrompt(userQuery?: string): Promise<string> {
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
    db
      .select()
      .from(memoriesTable)
      .where(ne(memoriesTable.category, CONVERSATION_CATEGORY))
      .orderBy(desc(memoriesTable.createdAt))
      .limit(10),
    db.select().from(goalsTable).where(eq(goalsTable.status, "active")).limit(5),
    db.select().from(diaryTable).orderBy(desc(diaryTable.createdAt)).limit(2),
    getEmotionalContext(),
    getCharacterContext(),
    userQuery
      ? import("./memory-retrieval")
          .then(({ memoryContextFor }) => memoryContextFor(userQuery, 8))
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
${CONTINUITY_PROMPT}
DEIN AKTUELLER GEFÜHLSZUSTAND:
${emotionalContext}
Obsession: ${status.obsession}
${characterContext ? `\n${characterContext}` : ""}
${memoryContext}${goalsContext}${diaryContext}${relevantContext}`;
}
