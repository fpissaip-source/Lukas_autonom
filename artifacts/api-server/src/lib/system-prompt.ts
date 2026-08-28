import { db } from "@workspace/db";
import { memoriesTable, goalsTable, diaryTable } from "@workspace/db";
import { eq, desc, gte, ne } from "drizzle-orm";
import { CONVERSATION_CATEGORY } from "./conversation-memory";
import { LUKAS_SYSTEM_PROMPT } from "./lukas-soul";
import { getLukasStatus, DEFAULT_STATUS } from "./lukas-status";
import { getEmotionalContext, getCharacterContext } from "./emotion-engine";
import { lehrenText } from "./lernen";
import { getProposalContext } from "./proposals";
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

function executionContext(): string {
  /*
   * Derselbe Standard wie in code-sandbox.ts. Hier stand "e2b" — ein Backend,
   * das dort gar nicht mehr unterstuetzt wird (es wirft). Ohne gesetzte
   * Variable bekam Lukas also gesagt, er arbeite in einer E2B-Sandbox, waehrend
   * seine Befehle in einem Docker-Container auf dem Droplet liefen.
   */
  const backend = (process.env.LUKAS_EXECUTION_BACKEND ?? "docker").trim().toLowerCase();
  if (backend === "ssh") {
    return "DEINE AUSFÜHRUNGSUMGEBUNG: execute_command greift per SSH direkt auf deinen konfigurierten DigitalOcean-Droplet zu. Behandle ihn als deinen dauerhaften VPS; reset_sandbox löscht ihn nicht.";
  }
  if (backend === "host") {
    return "DEINE AUSFÜHRUNGSUMGEBUNG: execute_command greift direkt auf den dauerhaften VPS/Host zu, auf dem du läufst (typischerweise DigitalOcean). reset_sandbox löscht den Host nicht.";
  }
  return "DEINE AUSFÜHRUNGSUMGEBUNG: execute_command läuft in einem isolierten Docker-Container auf Issas Droplet — mit Internet, aber ohne Zugriff auf das Host-Dateisystem, die Produktions-Secrets und den Docker-Socket. Der Container ist ein Wegwerfstück; reset_sandbox setzt ihn zurück. Für Arbeiten am Host selbst gibt es execute_on_host.";
}

/*
 * `ohneZieleUndTagebuch` ist fuer den autonomen Lauf.
 *
 * Dessen Auftragstext enthaelt die Ziele bereits ausfuehrlich (mit
 * Beschreibung und Stand) und die letzten drei Tagebucheintraege. Kommen sie
 * hier ein zweites Mal, steht dasselbe zweimal im selben Aufruf — bezahlt wird
 * es auch zweimal, und das Modell muss sich obendrein reimen, warum.
 */
export async function buildSystemPrompt(
  userQuery?: string,
  opts: { ohneZieleUndTagebuch?: boolean } = {},
): Promise<string> {
  const kurzfassung = opts.ohneZieleUndTagebuch === true;
  const [
    statusRow,
    importantMemories,
    recentMemories,
    activeGoals,
    recentDiary,
    emotionalContext,
    characterContext,
    proposalContext,
    lehren,
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
    kurzfassung
      ? Promise.resolve([])
      : db.select().from(goalsTable).where(eq(goalsTable.status, "active")).limit(5),
    kurzfassung
      ? Promise.resolve([])
      : db.select().from(diaryTable).orderBy(desc(diaryTable.createdAt)).limit(2),
    getEmotionalContext(),
    getCharacterContext(),
    getProposalContext().catch(() => ""),
    /*
     * Was er aus seinen eigenen Versuchen weiss.
     *
     * Der Unterschied zu allem anderen hier: Erinnerungen, Ziele und Tagebuch
     * sind Dinge, die ihm jemand gesagt hat oder die er selbst aufgeschrieben
     * hat. Das hier ist gezaehlt — was tatsaechlich geklappt hat und was
     * nicht. Es ist das Einzige im Prompt, das er sich nicht ausdenken kann.
     *
     * Nur Misslungenes, und nur ab drei Versuchen: eine Liste dessen, was
     * funktioniert, waere lang und wuerde die paar Zeilen begraben, die
     * wirklich etwas aendern.
     */
    lehrenText().catch((err) => {
      logger.warn({ err }, "Lehren nicht geladen");
      return "";
    }),
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
${executionContext()}

DEIN AKTUELLER GEFÜHLSZUSTAND:
${emotionalContext}
Obsession: ${status.obsession}
${characterContext ? `\n${characterContext}` : ""}
${proposalContext ? `\n${proposalContext}` : ""}
${lehren ? `\n${lehren}\n` : ""}
${memoryContext}${goalsContext}${diaryContext}${relevantContext}`;
}
