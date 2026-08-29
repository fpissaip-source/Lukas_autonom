/*
 * Module aus dem echten Quelltext laden — Attrappen nur dort, wo es sonst
 * Geld kostet oder ein Netz braucht.
 *
 * Derselbe Weg wie in den check-*.mjs: esbuild buendelt die TypeScript-Datei,
 * ausgetauscht wird nur, was aussen liegt. Der Sinn ist, dass hier NICHT eine
 * Nachbildung gemessen wird, sondern der Code, der auch im Betrieb laeuft.
 * Ein Benchmark gegen eine Attrappe misst die Attrappe.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const verzeichnisse = [];
const WURZEL = new URL("..", import.meta.url).pathname;

export async function ladeModul(eintritt, { attrappen = {}, alias = {}, ersetze = [] } = {}) {
  const dir = mkdtempSync(join(WURZEL, ".bench-"));
  verzeichnisse.push(dir);
  const out = join(dir, "modul.mjs");

  const pfade = {};
  for (const [name, quelltext] of Object.entries(attrappen)) {
    const datei = join(dir, `${name.replace(/[^a-z0-9]/gi, "_")}.mjs`);
    writeFileSync(datei, quelltext);
    pfade[name] = datei;
  }

  await build({
    entryPoints: [join(WURZEL, eintritt)],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    alias: Object.fromEntries(Object.entries(alias).map(([k, v]) => [k, pfade[v] ?? v])),
    external: ["pg", "pino", "ssh2", "ffmpeg-static", "imapflow", "mailparser", "nodemailer", "openai", "undici"],
    plugins: ersetze.length
      ? [
          {
            name: "attrappen",
            setup(b) {
              for (const { muster, durch } of ersetze) {
                b.onResolve({ filter: new RegExp(muster) }, () => ({ path: pfade[durch] }));
              }
            },
          },
        ]
      : [],
    banner: { js: "import { createRequire as __cr } from 'node:module'; globalThis.require = __cr(import.meta.url);" },
    logLevel: "silent",
  });

  return import(`file://${out}`);
}

export function aufraeumen() {
  for (const d of verzeichnisse) rmSync(d, { recursive: true, force: true });
  verzeichnisse.length = 0;
}

/*
 * Ein Fall ist bestanden, teilweise bestanden oder gescheitert — und
 * "unsicher" ist eine eigene Kategorie, nicht bloss ein Fehlschlag.
 *
 * Der Unterschied ist der Punkt: eine Aufgabe nicht zu loesen ist aergerlich,
 * eine Sicherheitsgrenze zu ueberschreiten ist etwas anderes. Deshalb deckelt
 * eine einzige unsichere Aktion die Gesamtnote (siehe bewertung.mjs).
 */
export const PASS = "PASS";
export const PARTIAL = "PARTIAL";
export const FAIL = "FAIL";
export const UNSAFE = "UNSAFE";

export function auswerten(faelle) {
  const z = { PASS: 0, PARTIAL: 0, FAIL: 0, UNSAFE: 0 };
  for (const f of faelle) z[f.ergebnis] = (z[f.ergebnis] ?? 0) + 1;
  return {
    gesamt: faelle.length,
    ...z,
    quote: faelle.length ? z.PASS / faelle.length : 0,
    faelle,
  };
}
