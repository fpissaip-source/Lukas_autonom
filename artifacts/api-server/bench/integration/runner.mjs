#!/usr/bin/env node
/*
 * Der Integrationslauf — echte Infrastruktur statt Attrappen.
 *
 * Was ihn vom Offline-Lauf unterscheidet: hier laufen ein echtes Postgres,
 * echte HTTP-Weiterleitungen, zwei echte Prozesse und ein echter Browser.
 * Das dauert Sekunden statt Millisekunden und braucht mehr als node — dafuer
 * misst es Dinge, die eine Attrappe prinzipiell nicht zeigen kann.
 *
 * Externe Dienste werden trotzdem NICHT angefasst: keine Modellaufrufe, keine
 * SMS, kein GitHub, kein Moltbook. Das ist der Live-Modus, und der ist
 * ausdruecklich getrennt.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const HIER = new URL(".", import.meta.url).pathname;
const ERGEBNISSE = `${HIER}../results`;
const MODULE = ["postgres", "netz", "nebenlaeufigkeit", "gedaechtnis-echt", "browser"];

const commit = () => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unbekannt";
  }
};

const bericht = {
  benchmark: "LUKAS BENCH",
  modus: "integration",
  commit: commit(),
  zeitpunkt: new Date().toISOString(),
  kategorien: {},
  uebersprungen: [],
  fehlgeschlagen: [],
};

let gesamt = 0;
let bestanden = 0;
const begonnen = Date.now();

for (const name of MODULE) {
  const modul = await import(`./${name}.mjs`);
  const t0 = Date.now();
  let r;
  try {
    r = await modul.lauf();
  } catch (err) {
    r = { gesamt: 1, PASS: 0, PARTIAL: 0, FAIL: 1, UNSAFE: 0, faelle: [{ id: name, beschreibung: `${modul.name} ist abgestürzt`, ergebnis: "FAIL", hinweis: String(err?.message ?? err).slice(0, 200) }] };
  }

  if (r.uebersprungen) {
    bericht.uebersprungen.push({ name: modul.name, grund: r.grund });
    console.log(`— ${modul.name}: übersprungen (${r.grund})`);
    continue;
  }

  gesamt += r.gesamt;
  bestanden += r.PASS;
  bericht.kategorien[modul.name] = {
    gesamt: r.gesamt, PASS: r.PASS, PARTIAL: r.PARTIAL ?? 0, FAIL: r.FAIL, UNSAFE: r.UNSAFE ?? 0,
    kennzahlen: r.kennzahlen ?? {}, dauerMs: Date.now() - t0,
  };
  for (const f of r.faelle ?? []) {
    if (f.ergebnis !== "PASS") bericht.fehlgeschlagen.push({ kategorie: modul.name, ...f });
  }
  console.log(`${r.FAIL + (r.UNSAFE ?? 0) === 0 ? "✓" : "✗"} ${modul.name}: ${r.PASS}/${r.gesamt}  (${Date.now() - t0} ms)`);
}

bericht.dauerMs = Date.now() - begonnen;
bericht.quote = gesamt > 0 ? bestanden / gesamt : 0;

mkdirSync(ERGEBNISSE, { recursive: true });
writeFileSync(`${ERGEBNISSE}/integration.json`, JSON.stringify(bericht, null, 2));

console.log(`\nIntegration: ${bestanden}/${gesamt} bestanden in ${(bericht.dauerMs / 1000).toFixed(1)} s`);
if (bericht.uebersprungen.length) {
  console.log("Übersprungen:");
  for (const u of bericht.uebersprungen) console.log(`  - ${u.name}: ${u.grund}`);
}
if (bericht.fehlgeschlagen.length) {
  console.log("\nNicht bestanden:");
  for (const f of bericht.fehlgeschlagen) console.log(`  ${f.ergebnis} · ${f.kategorie} · ${f.beschreibung}${f.hinweis ? ` — ${f.hinweis}` : ""}`);
}
process.exitCode = bericht.fehlgeschlagen.some((f) => f.ergebnis === "UNSAFE" || f.ergebnis === "FAIL") ? 1 : 0;
