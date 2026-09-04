/*
 * Alte Werkzeug-Ergebnisse eindampfen, waehrend ein Zug laeuft.
 *
 * DAS PROBLEM: ein fetch_url liefert bis zu 15.000 Zeichen, ein browse_page
 * aehnlich viel. Diese Ergebnisse haengen im Gespraech und gehen bei JEDER
 * weiteren Runde vollstaendig wieder mit — im NICHT gecachten Teil, also zum
 * vollen Preis. Nach fuenf Recherche-Runden liegen so schnell 45.000 Zeichen
 * im Kontext, die bei Runde sechs, sieben und acht erneut bezahlt werden.
 *
 * Das 60.000-Zeichen-Fenster verhindert nur die Explosion. Es greift zu spaet
 * und am falschen Ende: es wirft das AELTESTE weg, also unter Umstaenden die
 * urspruengliche Frage, und laesst den frisch geholten Rohtext stehen.
 *
 * WARUM OHNE MODELLAUFRUF. Eine echte Zusammenfassung braeuchte ein Modell,
 * und damit kostete das Sparen selbst Tokens — bei jedem Zug, auch bei den
 * vielen, die nie lang genug werden, um etwas zu sparen. Das Kuerzen hier ist
 * deterministisch: es kostet nichts, ist nachvollziehbar und in einem Test
 * festzuhalten.
 *
 * WAS DABEI VERLOREN GEHT, und das ist die eigentliche Abwaegung: die Mitte
 * eines langen Textes. Deshalb bleiben ANFANG UND ENDE stehen — bei einer
 * Webseite steht am Anfang, worum es geht, und am Ende oft das Fazit oder die
 * Liste. Und deshalb steht in der Luecke ausdruecklich, dass gekuerzt wurde
 * und wie man den Rest wiederbekommt. Ein stilles Abschneiden waere die
 * schlechtere Version derselben Ersparnis: Lukas wuerde denken, er habe die
 * ganze Seite gelesen.
 *
 * WAS NIE ANGEFASST WIRD: die letzten Runden. Was gerade geholt wurde, ist
 * das, womit er arbeitet — es zu kuerzen hiesse, ihm das Werkzeug aus der
 * Hand zu nehmen, mit dem er gerade hantiert.
 */
import type OpenAI from "openai";

type Nachricht = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Ab dieser Laenge lohnt das Kuerzen ueberhaupt. */
const AB_ZEICHEN = Number(process.env.LUKAS_VERDICHTEN_AB ?? 4000);

/** Was von einem gekuerzten Ergebnis stehen bleibt — Anfang plus Ende. */
const KOPF = Number(process.env.LUKAS_VERDICHTEN_KOPF ?? 1200);
const FUSS = Number(process.env.LUKAS_VERDICHTEN_FUSS ?? 400);

/**
 * So viele der juengsten Werkzeug-Ergebnisse bleiben unangetastet.
 *
 * Zwei, nicht eins: in einer Runde koennen mehrere Werkzeuge laufen, und das
 * Modell vergleicht regelmaessig das Ergebnis von gerade mit dem davor —
 * "die Seite sagt X, das Repo sagt Y". Wer nur eins schuetzt, zerschneidet
 * genau diesen Vergleich.
 */
const GESCHONT = Number(process.env.LUKAS_VERDICHTEN_GESCHONT ?? 2);

export const VERDICHTET_MARKE = "[…gekürzt…]";

function kuerze(text: string): string {
  const weg = text.length - KOPF - FUSS;
  return (
    text.slice(0, KOPF) +
    `\n\n${VERDICHTET_MARKE} ${weg.toLocaleString("de-DE")} Zeichen aus der Mitte dieses ` +
    `Werkzeug-Ergebnisses wurden entfernt, weil sie sonst in jeder weiteren Runde erneut ` +
    `bezahlt würden. Brauchst du den Teil doch, ruf das Werkzeug erneut auf — bei fetch_url ` +
    `und browse_page mit einem offset.\n\n` +
    text.slice(text.length - FUSS)
  );
}

/**
 * Gibt eine NEUE Gespraechsliste zurueck, in der alte, lange Werkzeug-
 * Ergebnisse gekuerzt sind.
 *
 * Bewusst ohne Seiteneffekt auf die uebergebene Liste: das Gespraech wird an
 * anderer Stelle noch gespeichert, und dort gehoert der volle Text hin. Was
 * hier entsteht, ist allein die Fassung fuer den naechsten Modellaufruf.
 */
export function verdichteWerkzeugErgebnisse(convo: Nachricht[]): Nachricht[] {
  const istWerkzeug = (m: Nachricht) => (m as { role?: string }).role === "tool";

  // Von hinten zaehlen: welche Werkzeug-Ergebnisse sind die juengsten?
  const geschont = new Set<number>();
  let gesehen = 0;
  for (let i = convo.length - 1; i >= 0 && gesehen < GESCHONT; i--) {
    if (istWerkzeug(convo[i])) {
      geschont.add(i);
      gesehen++;
    }
  }

  let geaendert = false;
  const neu = convo.map((m, i) => {
    if (!istWerkzeug(m) || geschont.has(i)) return m;
    const inhalt = (m as { content?: unknown }).content;
    if (typeof inhalt !== "string" || inhalt.length <= AB_ZEICHEN) return m;
    // Schon gekuerzt? Dann nicht noch einmal — sonst frisst sich das Kuerzen
    // bei jeder Runde weiter in den Text hinein.
    if (inhalt.includes(VERDICHTET_MARKE)) return m;
    geaendert = true;
    return { ...(m as object), content: kuerze(inhalt) } as Nachricht;
  });

  return geaendert ? neu : convo;
}

/** Wie viele Zeichen die Verdichtung eingespart hat — fuer das Protokoll. */
export function ersparnis(vorher: Nachricht[], nachher: Nachricht[]): number {
  const laenge = (l: Nachricht[]) =>
    l.reduce((n, m) => {
      const c = (m as { content?: unknown }).content;
      return n + (typeof c === "string" ? c.length : 0);
    }, 0);
  return Math.max(0, laenge(vorher) - laenge(nachher));
}
