/*
 * Prueft, dass alte Werkzeug-Ergebnisse eingedampft werden — und dass dabei
 * nichts weggeht, was Lukas gerade braucht.
 *
 * Das Problem: ein fetch_url liefert bis zu 15.000 Zeichen. Die haengen
 * danach im Gespraech und gehen bei JEDER weiteren Runde vollstaendig wieder
 * mit, im nicht gecachten Teil, also zum vollen Preis. Nach fuenf
 * Recherche-Runden werden 45.000 Zeichen Rohtext in Runde sechs, sieben und
 * acht erneut bezahlt.
 *
 * Fuenf Eigenschaften, und die dritte ist die, an der so etwas gefaehrlich
 * wird:
 *
 *  1. Langes Altes wird gekuerzt.
 *  2. Kurzes bleibt, wie es ist — Kuerzen kostet Information, das lohnt sich
 *     nur bei Masse.
 *  3. Die JUENGSTEN Ergebnisse bleiben unangetastet. Was gerade geholt wurde,
 *     ist das, womit er arbeitet.
 *  4. Gekuerzt wird sichtbar, nicht still. Ein stilles Abschneiden waere die
 *     schlechtere Version derselben Ersparnis: Lukas dachte, er haette die
 *     ganze Seite gelesen.
 *  5. Zweimal kuerzen frisst sich nicht weiter hinein.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".verdicht-check-"));
const out = join(dir, "v.mjs");

await build({
  entryPoints: ["src/lib/ai/verdichten.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  logLevel: "silent",
});

const { verdichteWerkzeugErgebnisse, ersparnis, VERDICHTET_MARKE } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) { console.error(`FEHLER: ${was}`); fehler++; }
};

const werkzeug = (id, text) => ({ role: "tool", tool_call_id: id, content: text });
const lang = (n, zeichen = 15000) =>
  `SEITE ${n} ANFANG ` + "x".repeat(zeichen) + ` SEITE ${n} ENDE`;

// ── 1. Eine typische Recherche über fünf Runden ───────────────────────────
{
  const convo = [
    { role: "system", content: "Du bist Lukas." },
    { role: "user", content: "Recherchier das mal." },
    werkzeug("a", lang("A")),
    werkzeug("b", lang("B")),
    werkzeug("c", lang("C")),
    werkzeug("d", lang("D")),
    werkzeug("e", lang("E")),
  ];

  const neu = verdichteWerkzeugErgebnisse(convo);
  const gespart = ersparnis(convo, neu);

  pruefe("die Liste bleibt gleich lang — nichts wird weggeworfen", neu.length === convo.length);
  pruefe("es wird spürbar gespart", gespart > 30_000);

  // Die drei ältesten sind gekürzt …
  for (const [i, name] of [[2, "A"], [3, "B"], [4, "C"]]) {
    pruefe(`Ergebnis ${name} ist gekürzt`, neu[i].content.includes(VERDICHTET_MARKE));
    pruefe(`von ${name} steht der Anfang noch da`, neu[i].content.includes(`SEITE ${name} ANFANG`));
    pruefe(`und das Ende auch`, neu[i].content.includes(`SEITE ${name} ENDE`));
  }

  /*
   * … und die beiden jüngsten NICHT. Zwei, nicht eins: in einer Runde können
   * mehrere Werkzeuge laufen, und das Modell vergleicht regelmäßig das
   * Ergebnis von gerade mit dem davor.
   */
  pruefe("das jüngste Ergebnis bleibt vollständig", neu[6].content === convo[6].content);
  pruefe("das vorletzte auch", neu[5].content === convo[5].content);

  // Andere Rollen werden nie angefasst.
  pruefe("der System-Prompt bleibt", neu[0].content === "Du bist Lukas.");
  pruefe("die Frage bleibt", neu[1].content === "Recherchier das mal.");
}

// ── 2. Kurzes bleibt kurz ─────────────────────────────────────────────────
{
  const convo = [
    werkzeug("a", "Der Befehl lief durch. Exit 0."),
    werkzeug("b", "OK"),
    werkzeug("c", "fertig"),
    werkzeug("d", "auch fertig"),
  ];
  const neu = verdichteWerkzeugErgebnisse(convo);
  pruefe("kurze Ergebnisse werden nicht angefasst", neu === convo);
}

// ── 3. Gekürzt wird sichtbar, mit Weg zurück ──────────────────────────────
{
  const convo = [werkzeug("a", lang("A")), werkzeug("b", "x"), werkzeug("c", "y")];
  const neu = verdichteWerkzeugErgebnisse(convo);
  const text = neu[0].content;
  pruefe("es steht dran, dass gekürzt wurde", text.includes(VERDICHTET_MARKE));
  pruefe("mit der Zahl der entfernten Zeichen", /\d[\d.]* Zeichen/.test(text));
  pruefe("und wie man den Rest wiederbekommt", /offset/.test(text));
  pruefe(
    "der Grund steht dabei, nicht nur die Tatsache",
    /erneut bezahlt|bezahlt würden/.test(text),
  );
}

// ── 4. Zweimal kürzen frisst sich nicht weiter hinein ─────────────────────
/*
 * Der Fall tritt bei JEDER Runde auf: dieselbe Liste läuft erneut durch. Ohne
 * diese Sperre würde von einem Ergebnis nach zehn Runden nichts mehr übrig
 * sein — und zwar unbemerkt, weil die Marke ja schon dransteht.
 */
{
  /*
   * Mit den Voreinstellungen faellt das gekuerzte Ergebnis ohnehin unter die
   * Schwelle — der erste Anlauf dieses Tests hat deshalb NICHTS geprueft: die
   * Gegenprobe "Sperre entfernen" lief gruen durch.
   *
   * Also die Schwellen so gesetzt, dass das gekuerzte Ergebnis WIEDER darueber
   * liegt. Genau diese Lage entsteht, sobald jemand LUKAS_VERDICHTEN_AB
   * herunterdreht — und dann frisst sich das Kuerzen ohne Sperre bei jeder
   * Runde weiter hinein, unbemerkt, weil die Marke ja schon dransteht.
   */
  const dir3 = mkdtempSync(join(process.cwd(), ".verdicht-eng-"));
  const out3 = join(dir3, "v.mjs");
  process.env.LUKAS_VERDICHTEN_AB = "800";
  process.env.LUKAS_VERDICHTEN_KOPF = "1200";
  process.env.LUKAS_VERDICHTEN_FUSS = "400";
  await build({
    entryPoints: ["src/lib/ai/verdichten.ts"],
    bundle: true, format: "esm", platform: "node", outfile: out3, logLevel: "silent",
  });
  const eng = await import(`file://${out3}`);
  rmSync(dir3, { recursive: true, force: true });

  const convo = [werkzeug("a", lang("A")), werkzeug("b", "x"), werkzeug("c", "y")];
  const einmal = eng.verdichteWerkzeugErgebnisse(convo);
  pruefe("bei enger Schwelle wird überhaupt gekürzt", einmal[0].content !== convo[0].content);
  pruefe(
    "und das Ergebnis liegt WIEDER über der Schwelle — sonst prüft dieser Test nichts",
    einmal[0].content.length > 800,
  );

  const zweimal = eng.verdichteWerkzeugErgebnisse(einmal);
  const dreimal = eng.verdichteWerkzeugErgebnisse(zweimal);
  pruefe("zweimal kürzen ändert nichts mehr", zweimal[0].content === einmal[0].content);
  pruefe("dreimal auch nicht", dreimal[0].content === einmal[0].content);
  pruefe("und es wird nichts mehr gespart", eng.ersparnis(einmal, dreimal) === 0);

  delete process.env.LUKAS_VERDICHTEN_AB;
  delete process.env.LUKAS_VERDICHTEN_KOPF;
  delete process.env.LUKAS_VERDICHTEN_FUSS;
}

// ── 5. Das Original bleibt unberührt ──────────────────────────────────────
/*
 * Gekürzt wird nur die Fassung für DIESEN Aufruf. Das Gespräch wird an
 * anderer Stelle gespeichert, und dort gehört der volle Text hin.
 */
{
  const original = lang("A");
  const convo = [werkzeug("a", original), werkzeug("b", "x"), werkzeug("c", "y")];
  verdichteWerkzeugErgebnisse(convo);
  pruefe("die übergebene Liste wird nicht verändert", convo[0].content === original);
}

// ── 6. Ohne Werkzeug-Ergebnisse passiert nichts ───────────────────────────
{
  /*
   * DREI lange Nachrichten, nicht zwei. Mit zweien schuetzt die Regel "die
   * juengsten zwei bleiben" ohnehin beide — der erste Anlauf dieses Tests
   * hat deshalb nichts geprueft, und die Gegenprobe "auch System und Frage
   * kuerzen" lief gruen durch.
   */
  const convo = [
    { role: "system", content: "x".repeat(50_000) },
    { role: "user", content: "y".repeat(50_000) },
    { role: "assistant", content: "z".repeat(50_000) },
  ];
  pruefe(
    "ein langer System-Prompt wird NICHT gekürzt — der ist der gecachte Teil",
    verdichteWerkzeugErgebnisse(convo) === convo,
  );
}

if (fehler > 0) process.exit(1);
console.log(
  "OK — Verdichtung: Altes und Langes wird gekürzt, das Jüngste bleibt, sichtbar statt still, und nicht zweimal.",
);
