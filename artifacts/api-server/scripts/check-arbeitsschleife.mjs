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


// ── Budget je Zug ─────────────────────────────────────────────────────────
// Vorher gab es keins: 200 Runden konnten zehn Minuten oder drei Stunden sein,
// ein paar tausend Tokens oder eine Million.
{
  process.env.LUKAS_TURN_TOKEN_BUDGET = "10000";
  process.env.LUKAS_TURN_MAX_MINUTEN = "10000"; // Zeit hier bewusst kein Faktor
  const s = new Arbeitsschleife();

  s.naechsteRunde();
  s.verbucht({ rein: 4000, raus: 500 });
  pruefe("unter dem Budget läuft er ohne Bemerkung weiter", s.hinweise([]).length === 0);
  pruefe("und darf weiter", s.darfWeiter());
  pruefe("der Abbruchgrund ist leer", s.abbruchGrund() === null);

  s.naechsteRunde();
  s.verbucht({ rein: 6000, raus: 500 });
  const warnung = s.hinweise([]).map((h) => h.content).join(" ");
  pruefe("bei aufgebrauchtem Budget bekommt er einen Hinweis", /Budget/.test(warnung));
  pruefe("und wird nicht abgeschnitten, sondern soll zum Ende kommen", /zum Ende/.test(warnung));
  pruefe("er darf trotzdem noch fertig werden", s.darfWeiter());
  pruefe("der Hinweis kommt nur einmal", !/Budget/.test(s.hinweise([]).map((h) => h.content).join(" ")));

  // Erst deutlich darüber ist Schluss — sonst wirft man weg, was er schon hat.
  s.verbucht({ rein: 6000, raus: 0 });
  pruefe("bei 150 % ist Schluss", !s.darfWeiter());
  pruefe("und der Grund steht fest", /Budget/.test(s.abbruchGrund() ?? ""));
  pruefe("mit der echten Zahl darin", /17\.000|17000/.test(s.abbruchGrund() ?? ""));

  delete process.env.LUKAS_TURN_TOKEN_BUDGET;
  delete process.env.LUKAS_TURN_MAX_MINUTEN;
}

// Die Zeitgrenze wirkt genauso, auch ohne einen einzigen Token.
{
  process.env.LUKAS_TURN_MAX_MINUTEN = "0.0001"; // ~6 ms
  const s = new Arbeitsschleife();
  await new Promise((r) => setTimeout(r, 30));
  pruefe("nach der Zeitgrenze ist ebenfalls Schluss", !s.darfWeiter());
  pruefe("und es steht dran, dass es die Zeit war", /min/.test(s.abbruchGrund() ?? ""));
  delete process.env.LUKAS_TURN_MAX_MINUTEN;
}

// ── Ähnliche Aufrufe ──────────────────────────────────────────────────────
// Dieselbe Frage in anderen Worten ist formal nie derselbe Aufruf — und lief
// deshalb an der Wiederholungssperre vorbei.
{
  const s = new Arbeitsschleife();
  const suchen = ["foo bar", "foo bar latest", "latest foo bar", "foo bar neueste"];
  let texte = [];
  for (const q of suchen) {
    s.naechsteRunde();
    texte.push(
      ...s.hinweise([{ name: "web_search", arguments: JSON.stringify({ query: q }) }]).map((h) => h.content),
    );
  }
  const aehnlich = texte.filter((t) => t.includes("sehr ähnlich"));
  pruefe("vier Umformulierungen derselben Suche werden bemerkt", aehnlich.length === 1);
  pruefe("und er wird auf einen anderen Weg geschickt", /Werkzeug oder die Quelle/.test(aehnlich[0] ?? ""));
}

// Gegenrichtung, und die ist wichtiger: echte Arbeit darf nicht so aussehen.
{
  const s = new Arbeitsschleife();
  let texte = [];
  for (let i = 0; i < 12; i++) {
    s.naechsteRunde();
    texte.push(
      ...s
        .hinweise([{ name: "browse_page", arguments: JSON.stringify({ url: `https://x.test/seite/${i}` }) }])
        .map((h) => h.content),
    );
  }
  pruefe(
    "zwölf Seiten derselben Domain sind Arbeit, keine Wiederholung",
    !texte.some((t) => t.includes("sehr ähnlich")),
  );
}
{
  const s = new Arbeitsschleife();
  let texte = [];
  for (const befehl of ["npm install express", "npm run build", "git status", "ls -la /srv"]) {
    s.naechsteRunde();
    texte.push(
      ...s.hinweise([{ name: "execute_command", arguments: JSON.stringify({ command: befehl }) }]).map((h) => h.content),
    );
  }
  pruefe(
    "vier verschiedene Befehle ebenfalls nicht",
    !texte.some((t) => t.includes("sehr ähnlich")),
  );
}

if (fehler > 0) process.exit(1);
console.log(`OK — Arbeitsschleife: keine Bremse bei echter Arbeit, Hinweis nur beim Im-Kreis-Laufen (Notbremse ${NOTBREMSE}).`);
