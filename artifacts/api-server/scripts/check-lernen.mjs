/*
 * Prueft, dass Lukas aus dem lernt, was er tatsaechlich getan hat.
 *
 * Was es vorher gab: eine geschlossene Lernschleife — aber nur fuer Moltbook.
 * recordAction → recordActionOutcome → evaluateStrategies → Erfolgsrate →
 * naechste Entscheidung. Vier Aktionsarten, alle vier Moltbook. Ueberall
 * sonst hat Lukas etwas getan, es ging schief, und beim naechsten Mal wusste
 * er nichts davon.
 *
 * Vier Eigenschaften muessen stimmen, und drei davon sind leicht falsch zu
 * bauen:
 *
 *  1. DER SCHLUESSEL. "browser_do ist gescheitert" hilft nicht. "browser_do
 *     bei higgsfield ist dreimal gescheitert, immer an 'Knopf nicht gefunden'"
 *     hilft. Zu fein geschnitten (volle URL mit Parametern) gibt es nie zwei
 *     Erfahrungen zum selben Ding — und damit nie eine Lehre.
 *  2. DIE ERKENNUNG. Ein Werkzeug kann scheitern, ohne zu werfen: "Die Seite
 *     liess sich nicht bedienen: …" ist eine ganz normale Rueckgabe. Ohne
 *     diesen Fall stuende die Erfolgsquote bei 100 % und gelernt wuerde
 *     nichts. Umgekehrt darf eine harmlose Antwort NICHT als Misserfolg
 *     gelten — das brächte ihn von etwas ab, das funktioniert.
 *  3. DIE SCHWELLE. Einmal gescheitert ist Pech, dreimal ist ein Muster. Wer
 *     jeden Einzelfall in den Prompt schreibt, begraebt die Zeilen, auf die
 *     es ankommt.
 *  4. ES MUSS ANKOMMEN. Eine Erfahrung, die nur in einer Tabelle liegt, ist
 *     kein Lernen. Der Text muss den Grund nennen, nicht nur die Zahl.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".lern-check-"));
const out = join(dir, "lernen.mjs");
const attrappe = join(dir, "attrappe.mjs");

/*
 * Die Datenbank-Attrappe gibt schlicht zurueck, was in globalThis.__zeilen
 * liegt. Sie MUSS nichts rechnen — die Zaehlung steht absichtlich in
 * TypeScript und nicht in SQL, damit genau das hier pruefbar ist.
 */
writeFileSync(
  attrappe,
  `globalThis.__zeilen = [];
globalThis.__eingefuegt = [];
export const erfahrungenTable = new Proxy({}, { get: (_t, k) => String(k) });
export const and = () => ({}); export const eq = () => ({});
export const gte = () => ({}); export const desc = () => ({});
export const db = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: async () => globalThis.__zeilen }),
      orderBy: () => ({ limit: async () => globalThis.__zeilen }),
    }),
  }),
  insert: () => ({ values: async (w) => { globalThis.__eingefuegt.push(w); } }),
};
export const logger = { info() {}, warn() {}, error() {}, debug() {} };
`,
);

await build({
  entryPoints: ["src/lib/lernen.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    { name: "a", setup(b) { b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: attrappe })); } },
  ],
  logLevel: "silent",
});

const { kontextAus, istMisserfolg, merkeErfahrung, schlechteLehren, lehrenText, bisherGescheitert } =
  await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

// ── 1. Der Schlüssel ──────────────────────────────────────────────────────
pruefe(
  "zwei Seiten derselben Domain fallen auf denselben Schlüssel",
  kontextAus("browse_page", { url: "https://www.higgsfield.ai/a?x=1" }) ===
    kontextAus("browse_page", { url: "https://higgsfield.ai/b/c" }),
);
pruefe(
  "und der ist die Domain, nicht die ganze URL",
  kontextAus("fetch_url", { url: "https://example.com/lang/pfad?q=1" }) === "example.com",
);
pruefe(
  "verschiedene Domains bleiben verschieden — sonst lernte er Unsinn",
  kontextAus("fetch_url", { url: "https://a.test/" }) !==
    kontextAus("fetch_url", { url: "https://b.test/" }),
);
pruefe(
  "bei browser_do zählt die Sitzung",
  kontextAus("browser_do", { sitzung: "higgsfield", schritte: [] }) === "higgsfield",
);
pruefe(
  "bei Befehlen nur das Programm, nicht die Argumente",
  kontextAus("execute_command", { command: "npm run build --workspace=x" }) === "npm",
);
pruefe(
  "kaputte URLs ergeben keinen Schlüssel statt eines falschen",
  kontextAus("fetch_url", { url: "keine-url" }) === "",
);

// ── 2. Was als Misserfolg zählt ───────────────────────────────────────────
for (const text of [
  "Fehler: ECONNREFUSED",
  "Die Seite liess sich nicht bedienen: Timeout",
  "SMS an +49… nicht zugestellt: Guthaben",
  "Der Vorschlag konnte nicht übernommen werden",
]) {
  pruefe(`erkannt als Misserfolg: "${text.slice(0, 40)}…"`, istMisserfolg(text));
}
// Die Gegenrichtung ist die wichtigere: ein falsches "gescheitert" brächte
// Lukas von etwas ab, das funktioniert.
for (const text of [
  "Alle Schritte durch — jetzt auf: Higgsfield (https://higgsfield.ai/dashboard)",
  "Gefunden: 12 Treffer",
  "Die Mail liegt als Entwurf im Dashboard.",
  "",
]) {
  pruefe(`gilt NICHT als Misserfolg: "${text.slice(0, 40)}…"`, !istMisserfolg(text));
}

// ── 3. Ablegen ────────────────────────────────────────────────────────────
globalThis.__eingefuegt = [];
await merkeErfahrung({
  werkzeug: "browser_do",
  eingabe: { sitzung: "higgsfield" },
  ergebnis: "Die Seite liess sich nicht bedienen: Knopf nicht gefunden",
  conversationId: 7,
});
const abgelegt = globalThis.__eingefuegt[0];
pruefe("die Erfahrung wird abgelegt", Boolean(abgelegt));
pruefe("mit dem richtigen Ausgang", abgelegt.gelungen === false);
pruefe("mit dem Grund", abgelegt.grund.includes("Knopf nicht gefunden"));
pruefe("und dem Schlüssel", abgelegt.kontext === "higgsfield");

// Ein Fehler beim Lernen darf den Zug NIE kippen.
globalThis.__eingefuegt = null; // push() wirft gleich
let geworfen = false;
try {
  await merkeErfahrung({ werkzeug: "x", eingabe: {}, ergebnis: "ok" });
} catch {
  geworfen = true;
}
pruefe("ein Fehler beim Merken wirft nicht in den Zug hinein", !geworfen);
globalThis.__eingefuegt = [];

// ── 4. Die Schwelle ───────────────────────────────────────────────────────
const erfahrung = (werkzeug, kontext, gelungen, grund = "") => ({ werkzeug, kontext, gelungen, grund });

// Zweimal gescheitert ist noch kein Muster.
globalThis.__zeilen = [
  erfahrung("browser_do", "higgsfield", false, "Knopf nicht gefunden"),
  erfahrung("browser_do", "higgsfield", false, "Knopf nicht gefunden"),
];
pruefe("zweimal gescheitert ist noch keine Lehre", (await schlechteLehren()).length === 0);

// Dreimal schon.
globalThis.__zeilen.push(erfahrung("browser_do", "higgsfield", false, "Cookie-Banner im Weg"));
const lehren = await schlechteLehren();
pruefe("dreimal gescheitert ergibt eine Lehre", lehren.length === 1);
pruefe("mit der richtigen Zählung", lehren[0].versuche === 3 && lehren[0].gelungen === 0);
pruefe(
  "und dem HÄUFIGSTEN Grund, nicht dem letzten",
  lehren[0].haeufigsterGrund === "Knopf nicht gefunden",
);

// Was überwiegend funktioniert, gehört nicht in den Prompt.
globalThis.__zeilen = [
  erfahrung("web_search", "", true),
  erfahrung("web_search", "", true),
  erfahrung("web_search", "", true),
  erfahrung("web_search", "", false, "Timeout"),
];
pruefe("was meistens klappt, wird nicht gemeldet", (await schlechteLehren()).length === 0);

// Verschiedene Kontexte werden NICHT zusammengeworfen.
globalThis.__zeilen = [
  erfahrung("browse_page", "a.test", false, "403"),
  erfahrung("browse_page", "a.test", false, "403"),
  erfahrung("browse_page", "a.test", false, "403"),
  erfahrung("browse_page", "b.test", true),
  erfahrung("browse_page", "b.test", true),
  erfahrung("browse_page", "b.test", true),
];
const getrennt = await schlechteLehren();
pruefe("die kaputte Domain wird gemeldet", getrennt.length === 1 && getrennt[0].kontext === "a.test");
pruefe("die funktionierende nicht", !getrennt.some((l) => l.kontext === "b.test"));

// ── 5. Es muss ankommen ───────────────────────────────────────────────────
globalThis.__zeilen = [
  erfahrung("browser_do", "higgsfield", false, "Cookie-Banner im Weg"),
  erfahrung("browser_do", "higgsfield", false, "Cookie-Banner im Weg"),
  erfahrung("browser_do", "higgsfield", false, "Knopf nicht gefunden"),
  erfahrung("browser_do", "higgsfield", true),
];
const text = await lehrenText();
pruefe("der Prompt-Block nennt das Werkzeug", text.includes("browser_do"));
pruefe("und wo es war", text.includes("higgsfield"));
pruefe("und die Zählung", text.includes("1 von 4"));
pruefe(
  "und WORAN es lag — ohne den Grund wäre es nur eine traurige Zahl",
  text.includes("Cookie-Banner im Weg"),
);
pruefe(
  "und es bleibt eine Zählung, kein Verbot",
  text.includes("kein Verbot") || text.includes("Zählung"),
);

globalThis.__zeilen = [];
pruefe("ohne Erfahrungen steht nichts im Prompt", (await lehrenText()) === "");

// ── 6. Die gezielte Frage ─────────────────────────────────────────────────
globalThis.__zeilen = [
  erfahrung("browser_do", "higgsfield", false, "Cookie-Banner im Weg"),
  erfahrung("browser_do", "higgsfield", false, "Cookie-Banner im Weg"),
];
const stand = await bisherGescheitert("browser_do", { sitzung: "higgsfield" });
pruefe("die gezielte Frage zählt mit", stand.versuche === 2 && stand.gelungen === 0);
pruefe("und nennt den Grund", stand.grund === "Cookie-Banner im Weg");

if (fehler > 0) process.exit(1);
console.log(
  "OK — Lernen: Ausgänge werden gemerkt, gleiche Dinge fallen zusammen, ab drei Fehlschlägen steht der Grund im Prompt.",
);
