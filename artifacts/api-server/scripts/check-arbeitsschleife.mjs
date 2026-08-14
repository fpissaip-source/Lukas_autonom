/*
 * Prueft, dass Lukas NICHT eingegrenzt wird — und trotzdem nicht im Kreis
 * laeuft.
 *
 * Vorher stand da eine Zahl: nach 8 (spaeter 12) Werkzeugrunden war Schluss,
 * egal wie gut es lief. Braucht er 15 Seiten oder 20 Befehle, soll er 15 Seiten
 * und 20 Befehle machen. Die Pruefung haelt beide Richtungen fest, denn beide
 * sind leicht kaputtzumachen: eine zu strenge Wiederholungserkennung wuerde
 * ihn wieder bremsen, eine fehlende liesse ihn ewig laufen.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".schleife-check-"));
const out = join(dir, "schleife.mjs");

await build({
  entryPoints: ["src/lib/arbeitsschleife.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  logLevel: "silent",
});

const { Arbeitsschleife, NOTBREMSE } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

// 1. Echte Arbeit wird nicht gebremst: 40 VERSCHIEDENE Aufrufe, kein Hinweis.
{
  const s = new Arbeitsschleife();
  let hinweise = 0;
  for (let i = 0; i < 40; i++) {
    pruefe(`Runde ${i} muss erlaubt sein`, s.darfWeiter());
    s.naechsteRunde();
    hinweise += s.hinweise([
      { name: "browse_page", arguments: JSON.stringify({ url: `https://x.test/seite/${i}` }) },
    ]).length;
  }
  // Bei 40 Runden faellt genau eine Standortbestimmung an (Runde 25).
  pruefe("40 verschiedene Aufrufe erzeugen keine Wiederholungswarnung", hinweise <= 1);
  pruefe("nach 40 Runden darf er weitermachen", s.darfWeiter());
}

// 2. 20 Befehle hintereinander sind Arbeit, keine Schleife.
{
  const s = new Arbeitsschleife();
  let warnungen = 0;
  for (let i = 0; i < 20; i++) {
    s.naechsteRunde();
    const h = s.hinweise([
      { name: "execute_command", arguments: JSON.stringify({ command: `echo ${i}` }) },
    ]);
    warnungen += h.filter((x) => x.content.includes("denselben Argumenten")).length;
  }
  pruefe("20 unterschiedliche Befehle lösen keine Warnung aus", warnungen === 0);
}

// 3. Dreimal exakt dasselbe: genau EIN Hinweis, und er nennt beide Auswege.
{
  const s = new Arbeitsschleife();
  const gleich = { name: "fetch_url", arguments: JSON.stringify({ url: "https://x.test" }) };
  let texte = [];
  for (let i = 0; i < 6; i++) {
    s.naechsteRunde();
    texte.push(...s.hinweise([gleich]).map((h) => h.content));
  }
  const warnungen = texte.filter((t) => t.includes("denselben Argumenten"));
  pruefe("Wiederholung wird gemeldet", warnungen.length === 1);
  pruefe("und nicht bei jeder weiteren Runde erneut", warnungen.length < 2);
  pruefe(
    "der Hinweis erlaubt ausdrücklich das Weitermachen",
    warnungen[0]?.includes("Weitermachen ist ausdrücklich erlaubt"),
  );
  pruefe(
    "und bietet das ehrliche Aufgeben als Alternative",
    warnungen[0]?.includes("nicht weiterkommst"),
  );
  pruefe("er wird trotzdem nicht gestoppt", s.darfWeiter());
}

// 4. Die Notbremse liegt so hoch, dass normale Arbeit sie nie sieht.
pruefe("Notbremse deutlich über jeder normalen Arbeit", NOTBREMSE >= 100);
{
  const s = new Arbeitsschleife();
  while (s.darfWeiter()) s.naechsteRunde();
  pruefe("Notbremse greift irgendwann", s.notbremseGriff());
  pruefe("und zwar erst bei NOTBREMSE", s.rundenZahl === NOTBREMSE);
}

if (fehler > 0) process.exit(1);
console.log(`OK — Arbeitsschleife: keine Bremse bei echter Arbeit, Hinweis nur beim Im-Kreis-Laufen (Notbremse ${NOTBREMSE}).`);
