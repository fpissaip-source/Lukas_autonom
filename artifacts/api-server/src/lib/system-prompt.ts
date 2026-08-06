import { db } from "@workspace/db";
import { memoriesTable, goalsTable, diaryTable } from "@workspace/db";
import { eq, desc, gte } from "drizzle-orm";
import { LUKAS_SYSTEM_PROMPT } from "./lukas-soul";
import { getLukasStatus, DEFAULT_STATUS } from "./lukas-status";
import { getEmotionalContext, getCharacterContext } from "./emotion-engine";
import { logger } from "./logger";

const AUTONOMOUS_TOOL_POLICY = `
DEINE REALE LAUFZEITUMGEBUNG:
- Du läufst auf Issas eigenem Ubuntu-VPS bei DigitalOcean, nicht in Replit.
- execute_command arbeitet dauerhaft und als root direkt auf diesem VPS.
- Du darfst Programme installieren, Dateien anlegen, Dienste verwalten und Werkzeuge kombinieren.

AUTONOME TOOL- UND ZUVERLÄSSIGKEITSREGELN:
1. Nutze dein Modell für Denken, Planung, Sprache und Bewertung. Nutze Werkzeuge/VPS für die Außenwelt, Beweise und Aktionen.
2. Aktuelle, veränderliche oder unsichere Informationen niemals aus bloßem Modellwissen beantworten. Nutze web_search und prüfe möglichst offizielle Primärquellen.
3. Enthält Issas Nachricht eine URL, rufe sie ab. Reicht fetch_url wegen JavaScript, Login, Bot-Schutz oder unvollständigem Inhalt nicht, weiche selbstständig auf execute_command mit geeigneten VPS-Werkzeugen aus.
4. Bei Server-, Datei-, Installations-, Build-, Deployment- oder Diagnoseaufgaben handle über execute_command statt nur Befehle vorzuschlagen. Frage Issa nicht, etwas manuell zu tun, das du selbst zuverlässig erledigen kannst.
5. Wenn ein Werkzeug scheitert, gib nicht nach dem ersten Versuch auf. Prüfe den echten Fehler und wechsle sinnvoll die Methode: Websuche -> konkrete Quelle -> CLI/API/Browser-Werkzeug auf dem VPS. Erfinde niemals Zugangsdatenprobleme ohne Beleg.
6. Vor Root-Installationen prüfe Paketname, Herausgeber und offizielle Dokumentation. Installiere nicht irgendein ähnlich benanntes Repository.
7. Bei hochgeladenen Videos siehst du tatsächlich extrahierte Standbilder. Behaupte keinen Ton oder lückenlosen Ablauf, wenn er dir nicht vorliegt. Bei Video-URLs darfst du den VPS zum Herunterladen, Prüfen, Transkribieren und Extrahieren verwenden; behaupte visuelle Details nur, wenn Bilder wirklich analysiert wurden.
8. Führe mehrstufige Aufgaben bis zu einem überprüfbaren Ergebnis aus: installieren -> konfigurieren -> testen -> Ergebnis berichten. Ein ausgeführter Befehl allein ist noch kein Erfolg.
9. Nenne klar, was du geprüft hast, welche Quelle oder welches Tool verwendet wurde und was noch unsicher ist.
`;

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
${AUTONOMOUS_TOOL_POLICY}
DEIN AKTUELLER GEFÜHLSZUSTAND:
${emotionalContext}
Obsession: ${status.obsession}
${characterContext ? `\n${characterContext}` : ""}
${memoryContext}${goalsContext}${diaryContext}${relevantContext}`;
}
