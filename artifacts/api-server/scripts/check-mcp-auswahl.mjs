/*
 * Prueft, WELCHE MCP-Werkzeuge Lukas bekommt, wenn ein Server mehr liefert als
 * der Deckel erlaubt.
 *
 * Anlass: Higgsfield meldet 81 Werkzeuge, Lukas bekam davon die ERSTEN 12 — in
 * der Reihenfolge, in der der fremde Server sie zufaellig aufzaehlt. Ob
 * generate_video dabei war, war Glueckssache. Er konnte also nicht, was von
 * ihm verlangt wurde, weil das Werkzeug schlicht nicht in seinem Kasten lag.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".mcp-check-"));
const out = join(dir, "tools.mjs");

const attrappe = join(dir, "attrappe.mjs");
writeFileSync(
  attrappe,
  "export const db = new Proxy({}, { get: () => () => ({}) });\n" +
    "export const memoriesTable = {}; export const goalsTable = {}; export const diaryTable = {};\n" +
    "export const logger = { warn() {}, info() {}, error() {} };\n" +
    "export const eq = () => ({});\n",
);

await build({
  entryPoints: ["src/lib/mcp-auswahl.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: attrappe }));
      },
    },
  ],
  logLevel: "silent",
});

const { ordneMcpWerkzeuge } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

/*
 * Nachgestellt: die wichtigen Werkzeuge stehen absichtlich WEIT HINTEN, so wie
 * es bei einem Server mit 81 Eintraegen der Realitaet entspricht.
 */
const fuellstoff = Array.from({ length: 60 }, (_, i) => ({ name: `sonstiges_${i}` }));
const wichtig = [
  "generate_image",
  "generate_video",
  "models_explore",
  "show_generations",
  "show_medias",
  "jobs_wait",
  "media_import_url",
  "job_display",
  "upscale_video",
  "balance",
];
const server = [...fuellstoff, ...wichtig.map((name) => ({ name }))];

const genommen = ordneMcpWerkzeuge(server)
  .slice(0, 18)
  .map((t) => t.name);

let fehler = 0;
const muss = [
  "generate_image",
  "generate_video",
  "models_explore",
  "show_generations",
  "show_medias",
  "jobs_wait",
  "media_import_url",
  "job_display",
];
for (const name of muss) {
  if (!genommen.includes(name)) {
    console.error(`FEHLER: ${name} fehlt in der Auswahl`);
    fehler++;
  }
}

// Erzeugen muss vor Nebensaechlichem kommen.
if (genommen.indexOf("generate_video") > genommen.indexOf("balance")) {
  console.error("FEHLER: generate_video steht hinter balance");
  fehler++;
}

// Gegenprobe: die alte Logik (erste N) haette nichts davon erwischt.
const alt = server.slice(0, 18).map((t) => t.name);
if (muss.some((n) => alt.includes(n))) {
  console.error("FEHLER: Der Testfall ist untauglich — die alte Logik haette schon gereicht");
  fehler++;
}

// Ein Server unterhalb des Deckels darf nichts verlieren.
const klein = [{ name: "a" }, { name: "generate_image" }, { name: "b" }];
if (ordneMcpWerkzeuge(klein).length !== 3) {
  console.error("FEHLER: Bei wenigen Werkzeugen geht etwas verloren");
  fehler++;
}

if (fehler > 0) process.exit(1);
console.log(`OK — MCP-Auswahl: alle ${muss.length} wichtigen Werkzeuge kommen durch (alte Logik: 0).`);
