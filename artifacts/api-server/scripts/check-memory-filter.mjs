/*
 * Prueft, was ins Gedaechtnis kommt und was nicht.
 *
 * Anlass: im Dashboard stand "Issa: ?" als Erinnerung. Ein Fragezeichen hilft
 * bei keiner Suche und schiebt echte Erinnerungen aus der Liste.
 *
 * Die WICHTIGERE Haelfte dieser Pruefung ist die andere Richtung: kurz allein
 * darf kein Grund sein, etwas wegzuwerfen. "Merge", "Nein." oder eine
 * Telefonnummer sind kurz und trotzdem entscheidend. Lieber eine belanglose
 * Erinnerung zu viel als eine wichtige verloren.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".memory-check-"));
const out = join(dir, "mem.mjs");

// Datenbank und Logger werden hier nicht gebraucht — geprueft wird die reine
// Entscheidung, was erinnerungswert ist. Attrappen statt echter Verbindungen.
const attrappe = join(dir, "attrappe.mjs");
writeFileSync(
  attrappe,
  "export const db = { insert: () => ({ values: async () => {} }) };\n" +
    "export const memoriesTable = {};\n" +
    "export const logger = { warn() {}, info() {}, error() {} };\n",
);

// Auch den Logger abfangen: sonst zoege die Pruefung pino samt Worker-Threads
// mit herein, nur um eine Regex zu testen. Relative Pfade kann `alias` nicht,
// deshalb ein kleines Plugin.
const attrappenPlugin = {
  name: "attrappen",
  setup(build) {
    build.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: attrappe }));
  },
};

await build({
  entryPoints: ["src/lib/conversation-memory.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe },
  plugins: [attrappenPlugin],
  logLevel: "silent",
});

const { istErinnerungswert } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

// Wegwerfen: traegt ohne Bezug keine Aussage.
const raus = [
  "?",
  "??",
  "!",
  "...",
  "ok",
  "Okay",
  "hmm",
  "jo",
  "danke",
  "Danke!",
  "passt",
  "alles klar",
  "hi",
  "Moin",
  "gute nacht",
  "👍",
  "😂😂",
  "   ",
];

// Behalten: kurz, aber inhaltlich.
const drin = [
  "Merge",
  "Nein.",
  "Nein, mach das anders",
  "+4915259559707",
  "Seedance 2.5",
  "Push auf main",
  "Kein Branch mehr",
  "Lukas soll Subagenten haben",
  "Ja, aber erst nach dem Deploy",
  "Prüfe die Änderungen von ChatGPT",
  "Er antwortet nicht. Das passiert sporadisch",
];

let fehler = 0;
for (const t of raus) {
  if (istErinnerungswert(t)) {
    console.error(`FEHLER: "${t}" sollte NICHT gemerkt werden`);
    fehler++;
  }
}
for (const t of drin) {
  if (!istErinnerungswert(t)) {
    console.error(`FEHLER: "${t}" MUSS gemerkt werden`);
    fehler++;
  }
}

if (fehler > 0) process.exit(1);
console.log(`OK — Gedächtnis-Filter: ${raus.length + drin.length} Fälle korrekt.`);
