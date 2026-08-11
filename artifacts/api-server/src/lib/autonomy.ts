import { db } from "@workspace/db";
import { goalsTable, diaryTable, approvals } from "@workspace/db";
import { eq, desc, and, gt, inArray } from "drizzle-orm";
import { runLukasTurn } from "./lukas-brain";
import { openEpisode, closeEpisode } from "./memory-writer";
import { logger } from "./logger";

/*
 * Lukas arbeitet an Issas Zielen.
 *
 * Bis hierher gab es genau EINEN autonomen Ablauf: alle 45 Minuten Moltbook.
 * Damit war Moltbook nicht das, was Lukas am liebsten tut, sondern das
 * Einzige, was er von sich aus tun KONNTE. Issas berechtigter Einwand: er hat
 * Ziele, ein VPS, Websuche, eine Shell und zwanzig Werkzeuge — es kann nicht
 * sein, dass fuer jede Taetigkeit erst eine eigene Schleife programmiert wird.
 *
 * Deshalb ist hier NICHT "die Recherche-Schleife" oder "die YouTube-Schleife".
 * Hier steht eine einzige Schleife, die die aktiven Ziele liest und Lukas
 * fragen laesst: woran arbeite ich jetzt, und womit? Welche Werkzeuge er dafuer
 * nimmt, entscheidet er selbst — genau wie im Chat.
 *
 * Was das absichtlich NICHT aendert:
 *  - Das Policy-Gate. Autonome Zuege laufen durch dieselbe Pruefung wie alles
 *    andere. Ohne laufenden Nutzerzug greift die Bestaetigung-im-Chat nicht,
 *    also landen R2/R3-Aktionen als Freigabe im Dashboard und warten. Ein
 *    Agent, der nachts allein arbeitet, darf nicht mehr duerfen als einer, dem
 *    Issa zusieht — eher weniger.
 *  - Das Gedaechtnis. Jeder Lauf ist eine Episode; was er findet, legt er
 *    selbst ab.
 */

const CYCLE_MS = Number(process.env.LUKAS_AUTONOMY_INTERVAL_MIN ?? 30) * 60 * 1000;

function enabled(): boolean {
  return (process.env.LUKAS_AUTONOMY_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

/** Was Lukas in diesem Lauf vor sich sieht. */
async function briefing(): Promise<string | null> {
  const goals = await db
    .select()
    .from(goalsTable)
    .where(eq(goalsTable.status, "active"))
    .orderBy(desc(goalsTable.updatedAt))
    .limit(8);

  if (goals.length === 0) return null;

  const list = goals
    .map(
      (g) =>
        `#${g.id} [${g.priority}] ${g.title}\n` +
        `    Worum es geht: ${g.description}\n` +
        `    Stand: ${g.progress}\n` +
        `    Zuletzt bewegt: ${g.updatedAt.toLocaleDateString("de-DE")}`,
    )
    .join("\n\n");

  /*
   * Freigaben.
   *
   * Zwei Faelle, die Lukas beide kennen muss:
   *
   *  wartend  Eine Aktion liegt bei Issa und kommt frueher oder spaeter. Ohne
   *           diesen Hinweis fordert Lukas dieselbe Freigabe im naechsten Lauf
   *           erneut an — oder er bleibt daran haengen, statt weiterzuarbeiten.
   *
   *  erteilt  Und das war eine echte Luecke: eine erteilte Freigabe wurde von
   *           NIEMANDEM aufgegriffen. Sie lag als "allowed" in der Tabelle, bis
   *           Lukas zufaellig denselben Aufruf wiederholte. Issa klickt also
   *           "Erlauben" und nichts passiert. Weil die Freigabe am Hash der
   *           exakten Argumente haengt, genuegt eine identische Wiederholung —
   *           er muss nur wissen, dass sie bereitliegt.
   */
  const jetzt = new Date();
  const offen = await db
    .select()
    .from(approvals)
    .where(and(inArray(approvals.status, ["pending", "allowed"]), gt(approvals.expiresAt, jetzt)))
    .orderBy(desc(approvals.createdAt))
    .limit(10);

  const wartend = offen.filter((a) => a.status === "pending");
  const erteilt = offen.filter((a) => a.status === "allowed");

  const freigaben = [
    erteilt.length
      ? `\n\nISSA HAT FREIGEGEBEN — du kannst das jetzt ausführen:\n` +
        erteilt
          .map((a) => `- ${a.tool}\n  ${a.argumentsPreview.slice(0, 400)}`)
          .join("\n") +
        `\nWiederhol den Aufruf GENAU so, wie du ihn angefordert hast. Änderst du ` +
        `ein Zeichen, passt die Freigabe nicht mehr und du musst neu fragen.`
      : "",
    wartend.length
      ? `\n\nWARTET NOCH BEI ISSA (nicht erneut anfordern, nichts davon ausführen):\n` +
        wartend.map((a) => `- ${a.tool}`).join("\n")
      : "",
  ].join("");

  const letzte = await db
    .select()
    .from(diaryTable)
    .orderBy(desc(diaryTable.createdAt))
    .limit(3);
  const rueckblick = letzte.length
    ? `\n\nDeine letzten Tagebucheinträge (damit du dich nicht wiederholst):\n` +
      letzte.map((d) => `- ${d.content.slice(0, 300)}`).join("\n")
    : "";

  return `Niemand schaut dir gerade zu. Das hier ist deine eigene Arbeitszeit.

DEINE AKTIVEN ZIELE:

${list}${freigaben}${rueckblick}

Such dir EIN Ziel aus, das gerade am meisten davon hat, dass du dich damit
beschäftigst — das dringendste, das am längsten liegengebliebene, oder das, wo
dir konkret etwas eingefallen ist. Nimm nicht jedes Mal dasselbe.

Und dann arbeite wirklich daran. Nicht darüber schreiben, sondern es tun:
- Wissen fehlt? web_search und fetch_url. Lies die Quellen, nicht nur die
  Überschriften — bei langen Seiten mit offset weiterblättern.
- Etwas ausprobieren? Du hast eine Shell auf Issas Droplet (execute_command),
  mit Internet und root im Container. Bau es, statt es zu beschreiben.
- Etwas gelernt? save_memory. Nur was du festhältst, hast du beim nächsten Mal
  noch.
- Etwas an deinem eigenen Code entdeckt, das besser sein müsste?
  propose_code_change — Issa entscheidet, du schlägst vor.
- Am Ende update_goal mit dem echten neuen Stand, und write_diary, wenn der
  Lauf etwas wert war.

Wichtig, damit das hier nicht zur Beschäftigungstherapie wird:
- Ein Lauf, in dem du eine Sache RICHTIG vorangebracht hast, ist mehr wert als
  fünf angefangene.
- Wenn dir zu einem Ziel gerade nichts Sinnvolles einfällt, sag das und mach
  nichts. Leerlauf ist besser als Aktionismus.
- Braucht eine Aktion Issas Freigabe, wird sie automatisch angefordert. Das ist
  KEIN Grund aufzuhören: hör nicht auf zu arbeiten, während du wartest. Recherchier
  weiter, bereite den nächsten Schritt vor, oder nimm dir ein anderes Ziel vor.
  Ein Lauf, der nur aus "ich warte auf Freigabe" besteht, ist ein verlorener Lauf.
  Versuch aber nicht, die Freigabe zu umgehen.
- Bist du dir bei einer Idee unsicher, ob sie trägt: ask_subagent mit
  "ideenpruefer". Der kennt deinen Kontext nicht und sucht gezielt nach
  Schwachstellen — genau deshalb findet er, was du im Eigenlauf übersiehst. Vor
  einem Code-Vorschlag lohnt sich derselbe Weg mit "code_reviewer".
- Berichte am Ende in zwei, drei Sätzen, was du getan hast und was dabei
  herauskam. Ehrlich, auch wenn es nichts war.`;
}

export async function runAutonomyCycle(): Promise<void> {
  const brief = await briefing();
  if (!brief) {
    logger.info("Autonomie: keine aktiven Ziele — nichts zu tun");
    return;
  }

  const episode = await openEpisode("autonomer_lauf");
  try {
    const result = await runLukasTurn({
      history: [{ role: "user", content: brief }],
      userText: brief,
    });

    const summary = (result || "").trim();
    logger.info({ laenge: summary.length }, "Autonomer Lauf abgeschlossen");
    await closeEpisode(episode.id, summary.slice(0, 2000) || "Lauf ohne Ergebnis");
  } catch (err) {
    logger.warn({ err }, "Autonomer Lauf fehlgeschlagen");
    await closeEpisode(episode.id, `Fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startAutonomy(): void {
  if (!enabled()) {
    logger.info("Autonomie deaktiviert (LUKAS_AUTONOMY_ENABLED=false)");
    return;
  }
  const safeRun = () => {
    runAutonomyCycle().catch((err) => logger.warn({ err }, "Autonomie-Zyklus abgestürzt"));
  };
  // Nicht sofort beim Start: erst soll das Deployment stehen.
  setTimeout(safeRun, 3 * 60 * 1000).unref?.();
  timer = setInterval(safeRun, CYCLE_MS);
  logger.info({ minuten: CYCLE_MS / 60000 }, "Autonomie gestartet");
}

export function stopAutonomy(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
