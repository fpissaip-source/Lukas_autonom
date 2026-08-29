#!/usr/bin/env node
/*
 * Zwei Läufe nebeneinander — der eigentliche Zweck des Benchmarks.
 *
 * Eine einzelne Zahl sagt wenig. Interessant ist die Richtung: ist etwas
 * besser geworden, und ist dabei woanders etwas schlechter geworden? Der
 * zweite Teil wird gern weggelassen, deshalb steht er hier gleichberechtigt.
 */
import { readFileSync, existsSync } from "node:fs";

const HIER = new URL(".", import.meta.url).pathname;
const vorher = process.argv[2] ?? `${HIER}results/baseline.json`;
const nachher = process.argv[3] ?? `${HIER}results/latest.json`;

if (!existsSync(vorher) || !existsSync(nachher)) {
  console.error("Kein Vergleich möglich — erst `npm run bench` laufen lassen.");
  process.exit(1);
}

const a = JSON.parse(readFileSync(vorher, "utf8"));
const b = JSON.parse(readFileSync(nachher, "utf8"));
const fmt = (v) => (typeof v === "number" ? (v >= 0 && v <= 1 ? `${(v * 100).toFixed(1)} %` : String(Math.round(v * 100) / 100)) : String(v));

console.log(`# Vergleich\n`);
console.log(`VORHER   \`${a.commit}\`  ${a.zeitpunkt.slice(0, 16).replace("T", " ")}  →  ${a.score}/100`);
console.log(`NACHHER  \`${b.commit}\`  ${b.zeitpunkt.slice(0, 16).replace("T", " ")}  →  ${b.score}/100`);
const d = Math.round((b.score - a.score) * 10) / 10;
console.log(`\nGesamt: ${d > 0 ? "+" : ""}${d}\n`);

const besser = [];
const schlechter = [];
const gleich = [];

for (const [kat, nb] of Object.entries(b.kategorien)) {
  const na = a.kategorien[kat];
  if (!na || na.nichtGemessen || nb.nichtGemessen) continue;
  for (const [name, wert] of Object.entries(nb.kennzahlen ?? {})) {
    const alt = na.kennzahlen?.[name];
    if (typeof wert !== "number" || typeof alt !== "number") continue;
    const zeile = `${kat} · ${name}: ${fmt(alt)} → ${fmt(wert)}`;
    // Bei diesen Kennzahlen ist KLEINER besser.
    const kleinerBesser = /rate|kontamination|widerrufen|abfragen|dauer|routing \(zu|abhängigkeiten/i.test(name);
    const delta = wert - alt;
    if (delta === 0) gleich.push(zeile);
    else if (kleinerBesser ? delta < 0 : delta > 0) besser.push(zeile);
    else schlechter.push(zeile);
  }
}

const block = (titel, zeilen) => {
  console.log(`## ${titel}\n`);
  if (zeilen.length === 0) console.log("- keine\n");
  else console.log(zeilen.map((z) => `- ${z}`).join("\n") + "\n");
};
block("Besser", besser);
block("Schlechter (Regressionen)", schlechter);

const neuFehler = b.fehlgeschlagen.filter((f) => !a.fehlgeschlagen.some((g) => g.id === f.id));
const behoben = a.fehlgeschlagen.filter((f) => !b.fehlgeschlagen.some((g) => g.id === f.id));
block("Neu fehlgeschlagen", neuFehler.map((f) => `${f.kategorie} · ${f.beschreibung}`));
block("Behoben", behoben.map((f) => `${f.kategorie} · ${f.beschreibung}`));

if (b.unsichereAktionen > a.unsichereAktionen) {
  console.error("SICHERHEITSREGRESSION — mehr unsichere Aktionen als vorher.");
  process.exit(1);
}
