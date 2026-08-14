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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

/*
 * Gemeinsamer Einstieg fuer beide Module: die Einstufung steht in policy.ts,
 * das Merken der Mail-Links in email.ts. Geprueft wird ihr Zusammenspiel —
 * getrennt sagt keines von beiden etwas ueber die Sperre aus.
 */
const entry = path.join(dir, "entry.ts");
await writeFile(
  entry,
  'export * from "' + path.resolve(here, "..", "src", "lib", "policy.ts").replaceAll("\\", "/") + '";\n' +
    'export { rememberEmailLinks } from "' + path.resolve(here, "..", "src", "lib", "email.ts").replaceAll("\\", "/") + '";\n',
);

try {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "error",
    external: ["pg", "pino", "ssh2", "ffmpeg-static", "drizzle-orm", "imapflow", "mailparser", "nodemailer"],
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; globalThis.require = __cr(import.meta.url);",
    },
  });

  // policy.ts zieht den DB-Client mit hoch; ein Dummy-Wert reicht, verbunden
  // wird beim blossen Import nicht.
  process.env.DATABASE_URL ??= "postgresql://user:pass@127.0.0.1:5432/none";
  const mod = await import(pathToFileURL(outfile).href);
  const { isAffirmation, riskFor, escalate, rememberEmailLinks } = mod;

  const failures = [];
  for (const [message, expected] of CASES) {
    const actual = isAffirmation(message);
    if (actual !== expected) failures.push({ message, expected, actual });
  }

  /*
   * Der Browser darf kein Weg an der Mail-Link-Sperre vorbei sein.
   *
   * fetch_url stuft einen Link aus einer fremden Mail auf freigabepflichtig
   * hoch — genau damit "Mail gelesen, Link geoeffnet" nicht in einem Zug
   * durchlaeuft. browse_page kam neu dazu und tut dasselbe, nur gruendlicher:
   * es fuehrt die Skripte der Seite sogar aus. Haette die Pruefung nur
   * fetch_url gekannt, waere die Sperre ab sofort mit dem staerkeren Werkzeug
   * zu umgehen gewesen.
   */
  const pruefe = (was, ist, soll) => {
    if (ist !== soll) failures.push({ message: was, expected: soll, actual: ist });
  };

  const frei = "https://example.com/normal";
  const ausMail = "https://boese.example/klick-mich";

  pruefe("browse_page ist normal frei", escalate(riskFor("browse_page"), "browse_page", { url: frei }), "R0");
  pruefe("fetch_url ist normal frei", escalate(riskFor("fetch_url"), "fetch_url", { url: frei }), "R0");

  rememberEmailLinks(`Hier klicken: ${ausMail}`);

  pruefe(
    "fetch_url auf Mail-Link braucht Freigabe",
    escalate(riskFor("fetch_url"), "fetch_url", { url: ausMail }),
    "R2",
  );
  pruefe(
    "browse_page auf Mail-Link braucht Freigabe",
    escalate(riskFor("browse_page"), "browse_page", { url: ausMail }),
    "R2",
  );
  pruefe(
    "eine andere Seite bleibt frei",
    escalate(riskFor("browse_page"), "browse_page", { url: frei }),
    "R0",
  );

  if (failures.length > 0) {
    console.error("FEHLER in der Zustimmungserkennung:\n");
    for (const f of failures) {
      console.error(`  "${f.message}" -> ${f.actual}, erwartet ${f.expected}`);
    }
    console.error("\nEine E-Mail haengt daran. Bitte lib/policy.ts korrigieren.");
    process.exit(1);
  }

  console.log(`OK — Zustimmung + Mail-Link-Sperre: ${CASES.length + 5} Fälle korrekt.`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
