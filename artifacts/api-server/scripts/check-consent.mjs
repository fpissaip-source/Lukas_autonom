#!/usr/bin/env node
/*
 * Testet die Zustimmungserkennung aus lib/policy.ts.
 *
 * Warum genau hier ein Test steht: an dieser Funktion haengt, ob eine E-Mail
 * rausgeht. Die erste Fassung war ein loses Regex, das in "Nein, schick das
 * noch NICHT ab" das Wort "schick" fand und den Versand freigab — also
 * ausgerechnet in dem Satz, mit dem man ihn stoppen will. So ein Fehler faellt
 * beim Lesen nicht auf und im Betrieb erst, wenn die Mail schon weg ist.
 *
 * Laeuft im typecheck mit. Bundelt policy.ts mit esbuild, weil die Datei TS ist
 * und ueber Workspace-Pakete importiert.
 */
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// [Nachricht, gilt als Zustimmung?]
const CASES = [
  // Eindeutige Zustimmung — muss durchgehen, sonst nervt es Issa.
  ["Ja, schick ab", true],
  ["ja", true],
  ["Ok mach", true],
  ["Senden", true],
  ["raus damit", true],
  ["passt so", true],
  ["Jup, abschicken", true],

  // Verneinung. Jeder dieser Saetze hat frueher den Versand ausgeloest.
  ["Nein, schick das noch nicht.", false],
  ["Schick das NICHT ab", false],
  ["Warte, noch nicht senden", false],
  ["Lieber nicht abschicken", false],
  ["stopp, nicht senden", false],
  ["Erstmal nicht senden", false],

  // Fragen sind keine Auftraege.
  ["Kannst du das theoretisch senden?", false],
  ["Soll ich das senden?", false],
  ["Wie verschickt man sowas?", false],

  // Weder noch.
  ["", false],
  ["   ", false],
  ["Erzähl mir was über Mails", false],
  // Ein Auftrag ist keine Bestaetigung eines konkreten Entwurfs: hier soll
  // Lukas erst zeigen, WAS er senden will, und dann fragen.
  ["Schreib Müller eine Mail", false],
];

// Innerhalb des Pakets ablegen, damit die externen Importe (drizzle-orm,
// pg, …) ueber das normale node_modules aufgeloest werden koennen.
const dir = await mkdtemp(path.join(here, "..", ".consent-check-"));
const outfile = path.join(dir, "policy.mjs");

try {
  await build({
    entryPoints: [path.resolve(here, "..", "src", "lib", "policy.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "error",
    external: ["pg", "pino", "ssh2", "ffmpeg-static", "drizzle-orm"],
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; globalThis.require = __cr(import.meta.url);",
    },
  });

  // policy.ts zieht den DB-Client mit hoch; ein Dummy-Wert reicht, verbunden
  // wird beim blossen Import nicht.
  process.env.DATABASE_URL ??= "postgresql://user:pass@127.0.0.1:5432/none";
  const { isAffirmation } = await import(pathToFileURL(outfile).href);

  const failures = [];
  for (const [message, expected] of CASES) {
    const actual = isAffirmation(message);
    if (actual !== expected) failures.push({ message, expected, actual });
  }

  if (failures.length > 0) {
    console.error("FEHLER in der Zustimmungserkennung:\n");
    for (const f of failures) {
      console.error(`  "${f.message}" -> ${f.actual}, erwartet ${f.expected}`);
    }
    console.error("\nEine E-Mail haengt daran. Bitte lib/policy.ts korrigieren.");
    process.exit(1);
  }

  console.log(`OK — Zustimmungserkennung: ${CASES.length} Fälle korrekt.`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
