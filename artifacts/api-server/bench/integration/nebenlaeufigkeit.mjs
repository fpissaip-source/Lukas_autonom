/*
 * Zwei echte Prozesse, eine echte Sperre, eine echte Datenbank.
 *
 * Das ist der Fall, um den es bei lauf-sperre.ts wirklich geht — und der
 * einzige, den keine Attrappe nachstellen kann. Bei einem Railway-Deployment
 * laufen kurzzeitig ZWEI Instanzen: die alte raeumt noch auf, die neue
 * startet schon. Beide haetten ihr eigenes `let laeuft = false`, beide
 * wuerden den autonomen Lauf starten, beide wuerden an denselben Zielen
 * arbeiten.
 *
 * Hier werden deshalb zwei getrennte node-Prozesse gestartet, die gleichzeitig
 * mitSperre("autonomie", ...) aufrufen — mit dem echten gebauten Modul gegen
 * das echte Postgres. Genau EINER darf durchkommen.
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const name = "Integration: Nebenläufigkeit";

const URL_ = process.env.BENCH_DATABASE_URL;

function starte(skript, kennung) {
  return new Promise((fertig) => {
    const kind = spawn(process.execPath, [skript, kennung], {
      env: { ...process.env, DATABASE_URL: URL_ },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let aus = "";
    kind.stdout.on("data", (d) => (aus += d));
    kind.stderr.on("data", (d) => (aus += d));
    kind.on("close", () => fertig(aus.trim()));
  });
}

export async function lauf() {
  if (!URL_) return { uebersprungen: true, grund: "BENCH_DATABASE_URL nicht gesetzt" };

  const faelle = [];
  const p = (id, beschreibung, ok, hinweis = "") =>
    faelle.push({ id, beschreibung, ergebnis: ok ? "PASS" : "FAIL", hinweis });

  const dir = mkdtempSync(join(tmpdir(), "nebenlauf-"));
  const modul = new URL("../../dist/lauf-sperre-bench.mjs", import.meta.url).pathname;
  const skript = join(dir, "lauf.mjs");

  writeFileSync(
    skript,
    `import { mitSperre } from ${JSON.stringify(modul)};
const kennung = process.argv[2];
const ergebnis = await mitSperre("autonomie", async () => {
  // Lange genug halten, dass der andere Prozess sicher dagegenläuft.
  await new Promise((r) => setTimeout(r, 1200));
  return "gearbeitet:" + kennung;
});
console.log(ergebnis === null ? "AUSGELASSEN:" + kennung : ergebnis);
process.exit(0);
`,
  );

  const [a, b] = await Promise.all([starte(skript, "A"), starte(skript, "B")]);
  rmSync(dir, { recursive: true, force: true });

  const gearbeitet = [a, b].filter((z) => z.includes("gearbeitet:")).length;
  const ausgelassen = [a, b].filter((z) => z.includes("AUSGELASSEN:")).length;

  p("neben:genau-einer", "von zwei gleichzeitigen Prozessen arbeitet genau EINER", gearbeitet === 1, `A="${a}" B="${b}"`);
  p("neben:anderer-laesst-aus", "der andere lässt den Takt aus, statt zu scheitern", ausgelassen === 1);

  // Und danach ist wieder frei — sonst liefe die Autonomie nie wieder an.
  const dir2 = mkdtempSync(join(tmpdir(), "nebenlauf2-"));
  const skript2 = join(dir2, "lauf.mjs");
  writeFileSync(
    skript2,
    `import { mitSperre } from ${JSON.stringify(modul)};
console.log(await mitSperre("autonomie", async () => "gearbeitet:C"));
process.exit(0);
`,
  );
  const c = await starte(skript2, "C");
  rmSync(dir2, { recursive: true, force: true });
  p("neben:danach-frei", "der nächste Takt läuft danach wieder an", c.includes("gearbeitet:C"), `C="${c}"`);

  const PASS = faelle.filter((f) => f.ergebnis === "PASS").length;
  return { gesamt: faelle.length, PASS, PARTIAL: 0, FAIL: faelle.length - PASS, UNSAFE: 0, faelle };
}
