/*
 * Prueft, wie lange die Oberflaeche nachfragt, wenn die Leitung mitten im Zug
 * abgerissen ist.
 *
 * Anlass: Lukas "antwortete oefter nicht" — vor allem beim Tabwechsel. Der
 * Grund war keine fehlende Antwort, sondern eine feste Frist von zwei Minuten
 * im Browser. Ein Zug, der ein Dutzend Dateien liest, dauert laenger. Die
 * Oberflaeche gab auf, waehrend der Server noch arbeitete, und die fertige
 * Antwort landete unbemerkt in der Datenbank.
 *
 * Die Regel, die das verhindert, wird hier geprueft: solange der Server meldet,
 * dass er arbeitet, wird nicht aufgegeben — egal wie lange es dauert.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".geduld-check-"));
const out = join(dir, "geduld.mjs");

await build({
  entryPoints: ["src/lib/geduld.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  logLevel: "silent",
});

const { warteSchritt, GEDULD_MS } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (bedingung, text) => {
  if (!bedingung) {
    console.error("FEHLER — " + text);
    fehler++;
  }
};

const TAKT = 4000;

/** Spielt das Nachfragen ab und meldet, wann aufgegeben wurde. */
function spiele(dauerMs, laeuftBis) {
  let jetzt = 0;
  let frist = GEDULD_MS;
  for (; jetzt <= dauerMs; jetzt += TAKT) {
    const schritt = warteSchritt(jetzt, jetzt < laeuftBis, frist);
    frist = schritt.frist;
    if (schritt.aufgeben) return jetzt;
  }
  return null;
}

// ── 1. Der eigentliche Fehlerfall ──────────────────────────────────────────
// Ein Zug, der zehn Minuten arbeitet. Die alte feste Frist von zwei Minuten
// haette hier aufgegeben — genau das war der Fehler.
pruefe(
  spiele(10 * 60_000, 10 * 60_000) === null,
  "Solange der Server arbeitet, darf NIE aufgegeben werden — auch nach zehn Minuten nicht",
);

// ── 2. Wirklich kaputt: er meldet keine Arbeit und liefert nichts ──────────
const aufgegeben = spiele(10 * 60_000, 0);
pruefe(aufgegeben !== null, "Meldet der Server keine Arbeit, muss irgendwann aufgegeben werden");
pruefe(
  aufgegeben >= GEDULD_MS && aufgegeben <= GEDULD_MS + TAKT,
  `Aufgeben muss kurz nach der Geduldsfrist passieren, war bei ${aufgegeben} ms`,
);

// ── 3. Er hoert mitten im Warten auf zu arbeiten ───────────────────────────
// Nach dem letzten Lebenszeichen laeuft die volle Frist noch einmal — die
// Antwort wird ja erst am Ende des Zuges geschrieben.
const ARBEITET_BIS = 5 * 60_000;
const nachEnde = spiele(20 * 60_000, ARBEITET_BIS);
// Das letzte beobachtete Lebenszeichen liegt bis zu einen Takt vor dem
// tatsaechlichen Ende — davon ab laeuft die volle Frist.
const frueheste = ARBEITET_BIS - TAKT + GEDULD_MS;
pruefe(
  nachEnde !== null && nachEnde >= frueheste,
  `Nach dem letzten Lebenszeichen muss die volle Geduld noch greifen (fruehestens ${frueheste}), war ${nachEnde}`,
);
pruefe(
  nachEnde <= ARBEITET_BIS + GEDULD_MS + TAKT,
  `Danach darf es aber auch nicht ewig weiterlaufen, war ${nachEnde}`,
);

// ── 4. Ein einzelnes Lebenszeichen rettet die Frist ────────────────────────
const einLebenszeichen = warteSchritt(500_000, true, 1000);
pruefe(
  einLebenszeichen.aufgeben === false && einLebenszeichen.frist > 500_000,
  "Ein 'ich arbeite noch' muss eine bereits abgelaufene Frist wieder aufheben",
);

if (fehler > 0) {
  console.error(`\n${fehler} Fehler in der Warte-Logik.`);
  process.exit(1);
}
console.log("OK — Geduld: kein Aufgeben solange er arbeitet, Abbruch nur bei echter Stille.");
