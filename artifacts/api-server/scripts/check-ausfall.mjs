/*
 * Prueft die Bremse fuer ausgefallene Bereiche.
 *
 * ANLASS: der Droplet war nicht erreichbar. Jeder Versuch lief zwanzig
 * Sekunden in die Zeitueberschreitung, und Lukas probierte weiter —
 * browse_page, browser_do, execute_command, in der naechsten autonomen Runde
 * von vorn. Alle drei laufen ueber denselben SSH-Weg.
 *
 * Der Preis steht nicht nur in der Zeit: jeder gescheiterte Aufruf kommt als
 * Werkzeugergebnis zurueck, geht in den naechsten Modellaufruf ein und wird
 * dort bezahlt. An dem Tag standen 406 Werkzeugaufrufe und 951.053 Tokens im
 * Dashboard, nach drei Fragen von Issa.
 *
 * Vier Eigenschaften, und die dritte ist die, an der eine solche Bremse
 * gefaehrlich wird:
 *
 *  1. EIN Fehlschlag macht noch nichts dicht — das kann ein Netzhaenger sein.
 *  2. Ab dem zweiten in Folge kommt die Diagnose sofort, ohne neuen Versuch.
 *  3. Nach der Abkuehlzeit wird WIEDER einer durchgelassen. Eine Bremse ohne
 *     Weg zurueck waere schlimmer als das Problem: der Droplet kaeme wieder,
 *     und Lukas wuesste es nie.
 *  4. Ein Erfolg raeumt sie sofort weg.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".ausfall-check-"));
const out = join(dir, "a.mjs");
const attrappe = join(dir, "l.mjs");
writeFileSync(attrappe, `export const logger = { info(){},warn(){},error(){},debug(){} };`);

await build({
  entryPoints: ["src/lib/ausfall.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  plugins: [
    { name: "a", setup(b) { b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: attrappe })); } },
  ],
  logLevel: "silent",
});

const { ausgefallen, merkeAusfall, merkeErfolg, ausfallStand, ausfaelleZuruecksetzen } =
  await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) { console.error(`FEHLER: ${was}`); fehler++; }
};

const GRUND = "Der Droplet (1.2.3.4:22) antwortet nicht auf SSH.";
const T0 = 1_000_000;
const MIN = 60_000;

// ── 1. Ein einzelner Fehlschlag macht nichts dicht ────────────────────────
ausfaelleZuruecksetzen();
{
  merkeAusfall("droplet-ssh", GRUND, T0);
  pruefe("nach EINEM Fehlschlag wird weiter versucht", ausgefallen("droplet-ssh", T0 + 1) === null);
}

// ── 2. Ab dem zweiten kommt die Diagnose sofort ───────────────────────────
{
  merkeAusfall("droplet-ssh", GRUND, T0 + 1000);
  const text = ausgefallen("droplet-ssh", T0 + 2000);
  pruefe("nach zwei Fehlschlägen ist dicht", text !== null);
  pruefe("und die gespeicherte Diagnose kommt zurück", text.includes("antwortet nicht auf SSH"));
  pruefe("mit dem Hinweis, dass gar nicht verbunden wurde", /nicht erst wieder verbunden/.test(text));
  pruefe("und wann es wieder versucht wird", /\d+ Sekunden/.test(text));
  /*
   * Der Satz, der die Runden spart: auch ein anderes Werkzeug auf demselben
   * Weg bringt nichts. Ohne ihn probiert Lukas die Geschwister durch.
   */
  pruefe(
    "und dass ein anderes Werkzeug auf demselben Weg auch nichts bringt",
    /anderen Werkzeug/.test(text),
  );
}

// ── 3. Nach der Abkühlzeit wird wieder einer durchgelassen ────────────────
/*
 * Eine Bremse ohne Weg zurück wäre schlimmer als das Problem: der Droplet
 * käme wieder, und Lukas wüsste es nie.
 */
{
  pruefe("kurz vor Ablauf noch dicht", ausgefallen("droplet-ssh", T0 + 4 * MIN) !== null);
  pruefe("nach fünf Minuten darf wieder einer", ausgefallen("droplet-ssh", T0 + 6 * MIN) === null);
}

// ── 4. Scheitert der auch, geht das Fenster weiter ────────────────────────
{
  merkeAusfall("droplet-ssh", GRUND, T0 + 6 * MIN);
  pruefe(
    "nach dem gescheiterten Versuch ist wieder dicht",
    ausgefallen("droplet-ssh", T0 + 7 * MIN) !== null,
  );
  pruefe(
    "und zwar erneut fünf Minuten lang",
    ausgefallen("droplet-ssh", T0 + 12 * MIN) === null,
  );
}

// ── 5. Ein Erfolg räumt sofort auf ────────────────────────────────────────
{
  merkeAusfall("droplet-ssh", GRUND, T0);
  merkeAusfall("droplet-ssh", GRUND, T0);
  pruefe("erst dicht", ausgefallen("droplet-ssh", T0 + 1) !== null);
  merkeErfolg("droplet-ssh");
  pruefe("nach einem Erfolg sofort wieder offen", ausgefallen("droplet-ssh", T0 + 2) === null);
  pruefe("und der Zähler ist weg", ausfallStand().length === 0);
}

// ── 6. Bereiche sind getrennt ─────────────────────────────────────────────
/*
 * Der Droplet kann tot sein, während GitHub einwandfrei antwortet. Wer beide
 * in einen Topf wirft, sperrt funktionierende Wege aus.
 */
ausfaelleZuruecksetzen();
{
  merkeAusfall("droplet-ssh", GRUND, T0);
  merkeAusfall("droplet-ssh", GRUND, T0);
  pruefe("der Droplet ist dicht", ausgefallen("droplet-ssh", T0 + 1) !== null);
  pruefe("ein anderer Bereich nicht", ausgefallen("github", T0 + 1) === null);
}

// ── 7. Und sie ist verdrahtet ─────────────────────────────────────────────
{
  const quelle = await import("node:fs").then((fs) =>
    fs.readFileSync("src/lib/code-sandbox.ts", "utf8"),
  );
  pruefe(
    "sshExec fragt VOR dem Verbinden, ob der Weg bekannt tot ist",
    /const bekannt = ausgefallen\(SSH_BEREICH\)/.test(quelle),
  );
  pruefe(
    "ein Fehlschlag wird gemerkt",
    /merkeAusfall\(SSH_BEREICH, diagnose\)/.test(quelle),
  );
  pruefe(
    "und ein Erfolg räumt auf — sonst bleibt der Droplet für immer 'tot'",
    /merkeErfolg\(SSH_BEREICH\)/.test(quelle),
  );
}

if (fehler > 0) process.exit(1);
console.log(
  "OK — Ausfallbremse: einer ist ein Hänger, zwei sind ein Ausfall, nach der Abkühlung wird wieder versucht, ein Erfolg räumt auf.",
);
