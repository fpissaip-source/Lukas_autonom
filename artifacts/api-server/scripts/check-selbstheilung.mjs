/*
 * Prueft, dass Lukas seine wiederkehrenden Fehler findet — und dass er sich
 * dabei nicht selbst frisst.
 *
 * Anlass: sein Fehlerprotokoll lag die ganze Zeit in der Datenbank und wurde
 * von genau einer Stelle gelesen — dem Dashboard. Er hatte kein Werkzeug
 * dafuer und war blind fuer seine eigenen Fehler.
 *
 * Zwei Dinge muessen stimmen, und beide sind leicht kaputtzumachen:
 *
 *  1. Gleichartige Meldungen muessen zu EINER Gruppe werden. "Container
 *     lukas-browser-17 fehlt" und "…-23 fehlt" sind derselbe Fehler, zweimal.
 *     Ohne das zaehlt nichts hoch, und nichts wird je als wiederkehrend
 *     erkannt.
 *  2. Verschiedene Fehler duerfen NICHT zusammenfallen. Eine zu grobe
 *     Normalisierung wuerde alles zu einem Brei machen und die Reparaturkette
 *     auf den falschen Fehler ansetzen.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".heilung-check-"));
const out = join(dir, "debug.mjs");

const attrappe = join(dir, "attrappe.mjs");
writeFileSync(
  attrappe,
  `globalThis.__zeilen ??= [];
export const debugLogTable = { createdAt: "createdAt" };
export const db = {
  insert: () => ({ values: () => ({ catch: () => {} }) }),
  select: () => ({
    from: () => ({
      where: () => ({ orderBy: () => ({ limit: async () => globalThis.__zeilen }) }),
      orderBy: () => ({ limit: async () => globalThis.__zeilen }),
    }),
  }),
};
export const desc = () => ({});
export const gte = () => ({});
export const logger = { info() {}, warn() {}, error() {} };
`,
);

await build({
  entryPoints: ["src/lib/debug-log.ts"],
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

const { fehlerSignatur, fehlerGruppen } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

const gleich = (a, b) => fehlerSignatur("tool:browse_page", a) === fehlerSignatur("tool:browse_page", b);

// 1. Dasselbe Problem in verschiedenen Ausprägungen — muss zusammenfallen.
pruefe(
  "unterschiedliche Container-Nummern sind derselbe Fehler",
  gleich(
    'The container name "/lukas-browser-17" is already in use',
    'The container name "/lukas-browser-23" is already in use',
  ),
);
pruefe(
  "unterschiedliche UUIDs sind derselbe Fehler",
  gleich(
    "Job 3f8a1c22-7b4e-4a11-9f2d-0c1e5a6b7c8d nicht gefunden",
    "Job 991a1c22-7b4e-4a11-9f2d-0c1e5a6b7cff nicht gefunden",
  ),
);
pruefe(
  "unterschiedliche Adressen sind derselbe Fehler",
  gleich("HTTP 403 beim Abruf von https://a.test/x", "HTTP 403 beim Abruf von https://b.test/y"),
);

// 2. VERSCHIEDENE Fehler duerfen nicht zusammenfallen.
pruefe(
  "ein anderer Fehlertext bleibt eine eigene Gruppe",
  !gleich("The container name is already in use", "Executable doesn't exist at chrome-linux"),
);
pruefe(
  "derselbe Text aus anderem Bereich bleibt getrennt",
  fehlerSignatur("tool:browse_page", "kaputt") !== fehlerSignatur("chat", "kaputt"),
);

// 3. Gruppieren und Sortieren an einem echten Protokoll.
const jetzt = new Date();
globalThis.__zeilen = [
  ...Array.from({ length: 5 }, (_, i) => ({
    scope: "tool:browse_page",
    message: `The container name "/lukas-browser-${i}" is already in use`,
    createdAt: jetzt,
  })),
  { scope: "chat", message: "Leere Antwort nach Werkzeugen", createdAt: jetzt },
  { scope: "chat", message: "Leere Antwort nach Werkzeugen", createdAt: jetzt },
  { scope: "selbstheilung", message: "Kette abgestürzt", createdAt: jetzt },
  { scope: "selbstheilung", message: "Kette abgestürzt", createdAt: jetzt },
  { scope: "selbstheilung", message: "Kette abgestürzt", createdAt: jetzt },
  { scope: "attachments", message: "Datei zu groß", createdAt: jetzt },
];

const alle = await fehlerGruppen(24);
pruefe("der häufigste Fehler steht oben", alle[0]?.anzahl === 5);
pruefe("und ist der Container-Fehler", alle[0]?.scope === "tool:browse_page");
pruefe("die fünf Container-Meldungen sind EINE Gruppe", alle.filter((g) => g.scope === "tool:browse_page").length === 1);
pruefe("der Beispieltext ist der echte Wortlaut", alle[0]?.beispiel.includes("already in use"));

/*
 * Der wichtigste Fall: die Selbstheilung darf ihre EIGENEN Fehler nicht
 * aufgreifen. Sonst untersucht sie beim naechsten Lauf den Fehler, der beim
 * Untersuchen entstanden ist — eine Schleife, die sich selbst fuettert und
 * bei jeder Runde drei Modellaufrufe kostet.
 */
const ohneSelbst = await fehlerGruppen(24, ["selbstheilung"]);
pruefe(
  "die Selbstheilung sieht ihre eigenen Fehler nicht",
  !ohneSelbst.some((g) => g.scope === "selbstheilung"),
);
pruefe("aber alle anderen weiterhin", ohneSelbst.length === alle.length - 1);

// 4. Ein leeres Protokoll ist kein Fehlerfall.
globalThis.__zeilen = [];
pruefe("leeres Protokoll ergibt keine Gruppen", (await fehlerGruppen(24)).length === 0);

if (fehler > 0) process.exit(1);
console.log("OK — Selbstheilung: Gleiches fällt zusammen, Verschiedenes nicht, eigene Fehler bleiben außen vor.");
