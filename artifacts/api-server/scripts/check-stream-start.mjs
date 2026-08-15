/*
 * Prueft, dass die Chat-Leitung SOFORT offen ist.
 *
 * Anlass: zwischen Issas Anfrage und dem ersten Byte standen fuenf await —
 * Nachricht speichern, Anhaenge zuordnen, Systemprompt bauen (holt Erinnerungen
 * aus der Datenbank), Verlauf laden, bei einem Video sogar ffmpeg. Waehrend der
 * ganzen Zeit ging nichts raus: keine Kopfzeilen, kein Lebenszeichen. Der
 * Browser sass da und wartete — und wenn das Netz in dem Moment wackelte, war
 * die Verbindung weg, bevor sie richtig stand. Im Chat stand dann "Load
 * failed".
 *
 * Das ist eine Reihenfolge im Quelltext, und genau die wird hier festgehalten.
 * Ein Test gegen einen laufenden Server wuerde eine Datenbank brauchen; die
 * Reihenfolge ist aber der ganze Inhalt der Sache.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const quelle = readFileSync(join(process.cwd(), "src/routes/anthropic.ts"), "utf-8");

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

const pos = (nadel) => quelle.indexOf(nadel);

const flush = pos("res.flushHeaders()");
const heartbeat = pos("heartbeat = setInterval");
const timeout = pos("req.setTimeout(0)");

pruefe("die Kopfzeilen werden überhaupt rausgeschickt", flush > 0);
pruefe("es gibt einen Heartbeat", heartbeat > 0);
pruefe("und Nodes 5-Minuten-Wecker ist für diese Route aus", timeout > 0);

/*
 * Die teuren Vorarbeiten. Jede einzelne davon kann Sekunden dauern, und keine
 * darf VOR dem ersten Byte stehen.
 */
for (const arbeit of [
  "await buildSystemPrompt(",
  "await buildAttachmentParts(",
]) {
  const p = pos(arbeit);
  pruefe(`"${arbeit}" kommt im Code vor`, p > 0);
  pruefe(`die Leitung steht VOR "${arbeit}"`, flush > 0 && p > flush);
  pruefe(`der Heartbeat läuft VOR "${arbeit}"`, heartbeat > 0 && p > heartbeat);
}

pruefe("der Heartbeat startet direkt nach den Kopfzeilen", heartbeat > flush);
pruefe("und der Wecker wird davor abgeschaltet", timeout > flush && timeout < heartbeat);

/*
 * Und die Gegenrichtung: die Pruefungen, die eine SAUBERE Fehlermeldung
 * brauchen, muessen VOR den Kopfzeilen stehen. Sind die Kopfzeilen erst
 * gesendet, kann kein 404 mehr kommen.
 */
pruefe(
  "die 404-Prüfung steht noch vor den Kopfzeilen",
  pos('res.status(404).json({ error: "Conversation not found" })') < flush,
);
pruefe(
  "die 400-Prüfung auch",
  pos('res.status(400).json({ error: "content required" })') < flush,
);

if (fehler > 0) process.exit(1);
console.log("OK — Chat-Start: Leitung und Heartbeat stehen vor jeder Vorarbeit.");
