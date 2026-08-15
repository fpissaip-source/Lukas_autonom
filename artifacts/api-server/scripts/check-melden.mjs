/*
 * Prueft die Wiederholsperre, wenn Lukas sich bei Issa meldet.
 *
 * Warum ausgerechnet die: der autonome Lauf startet alle 30 Minuten neu. Ohne
 * Sperre landet dieselbe offene Frage bei jedem Durchlauf erneut auf Issas
 * Handy — nach einem Tag waeren das 48 identische Nachrichten, und danach
 * liest er keine mehr. Eine Meldefunktion, die zu Spam wird, ist schlimmer als
 * keine.
 *
 * Die Gegenrichtung ist genauso wichtig: eine ANDERE Sache muss sofort
 * durchkommen. Eine Sperre, die alles blockiert, waere dasselbe wie keine
 * Meldung.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".melde-check-"));
const out = join(dir, "melden.mjs");

/*
 * Attrappen fuer Datenbank und WhatsApp: geprueft wird die Entscheidung, WANN
 * gemeldet wird — nicht, ob Postgres laeuft. Die Attrappen zaehlen mit, damit
 * die Pruefung sieht, was tatsaechlich rausgegangen waere.
 */
const attrappe = join(dir, "attrappe.mjs");
writeFileSync(
  attrappe,
  `// Zaehler auf globalThis: esbuild bundelt diese Attrappe MIT hinein, ein
// separater Import waere deshalb eine zweite Modulinstanz mit eigenen Zahlen.
globalThis.__zaehler ??= { chat: 0, whatsapp: 0 };
const zaehler = globalThis.__zaehler;
export const conversations = { title: "t", createdAt: "c", id: "id" };
export const messages = {};
export const db = {
  select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [{ id: 1 }] }) }) }) }),
  insert: () => ({
    values: async () => { zaehler.chat++; },
    returning: async () => [{ id: 1 }],
  }),
};
export const desc = () => ({});
export const eq = () => ({});
export const logger = { info() {}, warn() {}, error() {} };
export function whatsappConfigured() { return true; }
export async function sendWhatsAppMessage() { zaehler.whatsapp++; }
`,
);

await build({
  entryPoints: ["src/lib/melden.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        b.onResolve({ filter: /(^|\/)(logger|whatsapp)$/ }, () => ({ path: attrappe }));
      },
    },
  ],
  logLevel: "silent",
});

process.env.WHATSAPP_OWNER_NUMBERS = "+4915259559707";
const { meldeDichBeiIssa } = await import(`file://${out}`);
const zaehler = globalThis.__zaehler;
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

// 1. Die erste Meldung geht raus — Chat UND Handy.
const erste = await meldeDichBeiIssa({
  betreff: "Higgsfield-Zugang fehlt",
  text: "Ich komme an die Projektseite nicht ran, dort ist eine Anmeldung nötig.",
});
pruefe("erste Meldung landet im Chat", zaehler.chat === 1);
pruefe("erste Meldung geht auch aufs Handy", zaehler.whatsapp === 1);
pruefe("und die Antwort sagt ihm, dass sie angekommen ist", erste.includes("Handy"));
pruefe("und dass er weiterarbeiten soll", erste.includes("weiter"));

// 2. Dieselbe Sache noch einmal: NICHTS geht raus.
const zweite = await meldeDichBeiIssa({
  betreff: "Higgsfield-Zugang fehlt",
  text: "Immer noch das gleiche Problem.",
});
pruefe("Wiederholung landet nicht im Chat", zaehler.chat === 1);
pruefe("Wiederholung landet nicht auf dem Handy", zaehler.whatsapp === 1);
pruefe("und er erfährt, warum nicht", zweite.includes("schon gemeldet"));
pruefe("und wird zum Weiterarbeiten geschickt", zweite.includes("anderem"));

// 3. Eine ANDERE Sache muss sofort durchkommen.
await meldeDichBeiIssa({
  betreff: "Soll ich die alten Moltbook-Einträge löschen?",
  text: "Sie machen die Übersicht unlesbar.",
});
pruefe("eine andere Sache kommt sofort durch (Chat)", zaehler.chat === 2);
pruefe("eine andere Sache kommt sofort durch (Handy)", zaehler.whatsapp === 2);

// 4. Ohne Inhalt gibt es keine Meldung.
for (const leer of [
  { betreff: "", text: "irgendwas" },
  { betreff: "irgendwas", text: "" },
  { betreff: "   ", text: "   " },
]) {
  let geworfen = false;
  try {
    await meldeDichBeiIssa(leer);
  } catch {
    geworfen = true;
  }
  pruefe(`leere Meldung wird abgelehnt (${JSON.stringify(leer)})`, geworfen);
}
pruefe("und hat nichts verschickt", zaehler.chat === 2 && zaehler.whatsapp === 2);

if (fehler > 0) process.exit(1);
console.log("OK — Meldungen an Issa: 13 Fälle korrekt (kein Spam, nichts verschluckt).");
