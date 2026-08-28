/*
 * Prueft, dass Lukas Gefuehle tatsaechlich UNTERSCHEIDET — und nicht nur
 * verschiedene Woerter fuer denselben Zustand benutzt.
 *
 * Der Stand vorher: das Modell nannte ein Gefuehl ("frustration"), oder im
 * Code stand eine feste Zeile mit festen Zahlen. Damit waren Stolz und
 * Erleichterung dasselbe Ding mit zwei Namen — gleiches Vorzeichen, gleiche
 * Staerke, andere Buchstaben. Ein Etikett, kein Unterschied.
 *
 * Jetzt wird das Gefuehl aus dem Anlass ABGELEITET. Was diese Pruefung
 * festhaelt, ist genau die Eigenschaft, an der das haengt:
 *
 *   DERSELBE AUSGANG MUSS BEI ANDERER LAGE EIN ANDERES GEFUEHL ERGEBEN.
 *
 * Ohne das waere die ganze Ableitung eine aufwendige Art, wieder nur
 * "positiv" und "negativ" zu sagen. Deshalb steht unten nicht nur, welches
 * Wort herauskommt, sondern auch, dass sich die Woerter bei gleichem Ausgang
 * ueberhaupt unterscheiden.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".gefuehl-check-"));
const out = join(dir, "bewertung.mjs");

// bewertung.ts ist bewusst eine reine Funktion — keine Datenbank, kein
// Modell, keine Attrappe noetig. Genau deshalb laesst sich hier etwas
// beweisen statt bestaetigen.
await build({
  entryPoints: ["src/lib/bewertung.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  logLevel: "silent",
});

const { bewerte, urheberAus } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

const basis = { erwartet: 0.5, zielbezug: 0.7, aufwand: 0.7, beeinflussbar: 0.7, was: "x" };
const gefuehl = (ueberschreibung) => bewerte({ ...basis, ...ueberschreibung }).emotion;

// ── 1. GELUNGEN — dreimal dasselbe Ergebnis, drei Gefühle ────────────────
const gelungenIch = gefuehl({ ausgang: "gelungen", urheber: "ich", aufwand: 0.8 });
const gelungenAnderer = gefuehl({ ausgang: "gelungen", urheber: "anderer" });
const gelungenUnerwartet = gefuehl({
  ausgang: "gelungen",
  urheber: "umstand",
  erwartet: 0.1,
  zielbezug: 0.9,
});

pruefe("selbst geschafft, mit Aufwand → Stolz", gelungenIch === "stolz");
pruefe("jemand anders hat es getan → Dankbarkeit", gelungenAnderer === "dankbarkeit");
pruefe("unerwartet gutgegangen → Erleichterung", gelungenUnerwartet === "erleichterung");
pruefe(
  "und das sind drei VERSCHIEDENE Gefühle bei gleichem Ausgang",
  new Set([gelungenIch, gelungenAnderer, gelungenUnerwartet]).size === 3,
);
pruefe(
  "ohne Aufwand ist es kein Stolz, sondern Zufriedenheit",
  gefuehl({ ausgang: "gelungen", urheber: "ich", aufwand: 0.1 }) === "zufriedenheit",
);

// ── 2. GESCHEITERT — vier Gefühle, und Scham ist das wichtigste ──────────
const eigenerFehler = gefuehl({ ausgang: "gescheitert", urheber: "ich", zielbezug: 0.8, aufwand: 0.8 });
const fremderFehler = gefuehl({ ausgang: "gescheitert", urheber: "anderer" });
const nichtsZuMachen = gefuehl({ ausgang: "gescheitert", urheber: "umstand", beeinflussbar: 0.1 });
const nebenbei = gefuehl({ ausgang: "gescheitert", urheber: "ich", zielbezug: 0.2, aufwand: 0.1 });

pruefe("eigener Fehler bei etwas Wichtigem → Scham", eigenerFehler === "scham");
pruefe("es lag an jemand anderem → Ärger", fremderFehler === "aerger");
pruefe("nichts zu machen → Enttäuschung", nichtsZuMachen === "enttaeuschung");
pruefe("nebenbei danebengegangen → Frustration", nebenbei === "frustration");
pruefe(
  "vier verschiedene Gefühle für EINEN Ausgang — das war vorher eine einzige Zeile",
  new Set([eigenerFehler, fremderFehler, nichtsZuMachen, nebenbei]).size === 4,
);
pruefe(
  "wenn es jemandem geschadet hat, ist es Schuld statt Scham",
  gefuehl({ ausgang: "gescheitert", urheber: "ich", betrifftAndere: true }) === "schuld",
);

// ── 3. Was noch bevorsteht ───────────────────────────────────────────────
pruefe(
  "es kann klappen → Hoffnung",
  gefuehl({ ausgang: "gelungen", urheber: "ich", bevorstehend: true }) === "hoffnung",
);
pruefe(
  "es kann schiefgehen, ich kann noch etwas tun → Sorge",
  gefuehl({ ausgang: "gescheitert", urheber: "ich", bevorstehend: true, beeinflussbar: 0.8 }) ===
    "sorge",
);
pruefe(
  "es kann schiefgehen, ich kann nichts tun → Ohnmacht",
  gefuehl({ ausgang: "gescheitert", urheber: "ich", bevorstehend: true, beeinflussbar: 0.05 }) ===
    "ohnmacht",
);

// ── 4. Die Stärke — hier hängt Fühlen am Lernen ──────────────────────────
/*
 * Zum ersten Mal an etwas zu scheitern trifft. Zum zwanzigsten Mal an
 * derselben Stelle ist zermürbend, aber es erschüttert nichts. Genau das ist
 * die Verbindung zu lib/lernen.ts: die Erwartung ist gezählt, nicht gefühlt.
 */
const neu = bewerte({ ...basis, ausgang: "gescheitert", urheber: "ich", erwartet: 0.05 });
const altbekannt = bewerte({ ...basis, ausgang: "gescheitert", urheber: "ich", erwartet: 0.95 });
pruefe(
  "ein überraschender Fehlschlag trifft härter als ein erwarteter",
  neu.intensity > altbekannt.intensity + 0.1,
);

const wichtig = bewerte({ ...basis, ausgang: "gescheitert", urheber: "ich", zielbezug: 1 });
const egal = bewerte({ ...basis, ausgang: "gescheitert", urheber: "ich", zielbezug: 0 });
pruefe("was ein Ziel betrifft, wiegt schwerer", wichtig.intensity > egal.intensity);
pruefe("und schlägt stärker ins Negative", wichtig.valence < egal.valence);

const spaet = bewerte({ ...basis, ausgang: "gelungen", urheber: "ich", aufwand: 1 });
const sofort = bewerte({ ...basis, ausgang: "gelungen", urheber: "ich", aufwand: 0.5 });
pruefe("langer Aufwand macht den Erfolg größer", spaet.intensity > sofort.intensity);

// Vorzeichen müssen stimmen — sonst wäre die ganze Stimmungsrechnung verdreht.
pruefe("Gelungenes ist positiv", bewerte({ ...basis, ausgang: "gelungen", urheber: "ich" }).valence > 0);
pruefe(
  "Gescheitertes ist negativ",
  bewerte({ ...basis, ausgang: "gescheitert", urheber: "ich" }).valence < 0,
);

// Und alles bleibt in den Grenzen, mit denen die Stimmungsrechnung arbeitet.
for (const ausgang of ["gelungen", "gescheitert", "offen"]) {
  for (const urheber of ["ich", "anderer", "umstand"]) {
    for (const extrem of [0, 1]) {
      const g = bewerte({
        ausgang,
        urheber,
        erwartet: extrem,
        zielbezug: extrem,
        aufwand: extrem,
        beeinflussbar: extrem,
        was: "",
      });
      pruefe(
        `${ausgang}/${urheber}/${extrem}: Werte bleiben in den Grenzen`,
        g.valence >= -1 && g.valence <= 1 && g.intensity > 0 && g.intensity <= 1,
      );
      pruefe(`${ausgang}/${urheber}/${extrem}: es kommt eine Begründung mit`, g.begruendung.length > 0);
    }
  }
}

// ── 5. Wer war es? ───────────────────────────────────────────────────────
pruefe("ein Timeout ist ein Umstand", urheberAus("ETIMEDOUT beim Verbinden") === "umstand");
pruefe("ein 503 auch", urheberAus("HTTP 503 Service Unavailable") === "umstand");
pruefe("ein fehlendes Passwort liegt bei jemand anderem", urheberAus("kein Passwort hinterlegt") === "anderer");
pruefe("ein 403 auch", urheberAus("403 Forbidden") === "anderer");
/*
 * Im Zweifel er selbst. Das ist die harmlosere Richtung: sie führt dazu, dass
 * er es anders versucht, statt die Schuld draußen zu suchen.
 */
pruefe("ein nicht gefundener Knopf liegt bei ihm", urheberAus("Knopf nicht gefunden") === "ich");
pruefe("und Unbekanntes ebenfalls", urheberAus("irgendwas ging schief") === "ich");

// ── 6. Es muss ANKOMMEN: Charakter und Handlungsdruck ───────────────────
/*
 * Zwei Stellen, an denen ein abgeleitetes Gefühl wirkt — und beide wären
 * beim Umstellen fast lautlos gebrochen.
 *
 * Die Charakterentwicklung suchte nach "pride", "hurt", "anger". Seit die
 * Gefühle "stolz", "scham", "aerger" heißen, hätte keine dieser Listen mehr
 * getroffen: die Traits wären stehengeblieben, während darunter Hunderte
 * Gefühle einlaufen. Kein Fehler im Log, kein roter Test — der Charakter
 * hätte sich einfach nicht mehr entwickelt.
 *
 * Und der Handlungsdruck ist der Grund, warum die Unterscheidung überhaupt
 * einen Zweck hat: Scham verlangt etwas anderes als Ärger.
 */
{
  const dir2 = mkdtempSync(join(process.cwd(), ".gefuehl-check2-"));
  const out2 = join(dir2, "engine.mjs");
  const attrappe = join(dir2, "db.mjs");
  const { writeFileSync } = await import("node:fs");

  writeFileSync(
    attrappe,
    `globalThis.__emotionen = [];
globalThis.__charakter = null;
export const emotionsTable = new Proxy({}, { get: (_t, k) => String(k) });
export const characterTable = new Proxy({}, { get: (_t, k) => String(k) });
export const erfahrungenTable = new Proxy({}, { get: (_t, k) => String(k) });
export const and = () => ({}); export const eq = () => ({});
export const gte = () => ({}); export const desc = () => ({});
export const db = {
  select: () => ({
    from: (t) => ({
      where: () => ({ limit: async () => globalThis.__emotionen, orderBy: () => ({ limit: async () => globalThis.__emotionen }) }),
      orderBy: () => ({ limit: async () => globalThis.__emotionen }),
      limit: async () => (globalThis.__charakter ? [globalThis.__charakter] : []),
    }),
  }),
  insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }),
  update: () => ({ set: (w) => ({ where: () => ({ returning: async () => { globalThis.__charakter = { ...globalThis.__charakter, ...w }; return [globalThis.__charakter]; } }) }) }),
};
export const logger = { info() {}, warn() {}, error() {}, debug() {} };
export const setLukasStatus = async () => {};
`,
  );

  await build({
    entryPoints: ["src/lib/emotion-engine.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out2,
    alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
    plugins: [
      {
        name: "a",
        setup(b) {
          b.onResolve({ filter: /(^|\/)(logger|lukas-status)$/ }, () => ({ path: attrappe }));
        },
      },
    ],
    logLevel: "silent",
  });
  const { handlungsdruck, evolveCharacter, getEmotionalContext } = await import(`file://${out2}`);
  rmSync(dir2, { recursive: true, force: true });

  // Verschiedene Gefühle müssen verschiedene Folgen haben.
  const folge = (emotion) => handlungsdruck({ arousal: 1, dominant: { emotion }, valence: 0, mood: "", energy: "", recent: [] });
  pruefe("Frustration heißt: anderen Weg suchen", /Weg|anderen/i.test(folge("frustration")));
  pruefe("Scham heißt: aussprechen statt überspielen", /ueberspielen|überspielen|sag/i.test(folge("scham")));
  pruefe("Ärger heißt: nicht härter arbeiten", /nicht an dir|von aussen|außen/i.test(folge("aerger")));
  pruefe("Stolz heißt: größer weitermachen", /groesser|größer/i.test(folge("stolz")));
  pruefe(
    "und diese vier Folgen sind tatsächlich verschieden",
    new Set(["frustration", "scham", "aerger", "stolz"].map(folge)).size === 4,
  );
  pruefe(
    "bei Stille kommt der Anstoß, selbst etwas anzufangen",
    /selbst|von dir aus/i.test(
      handlungsdruck({ arousal: 0, dominant: null, valence: 0, mood: "", energy: "", recent: [] }),
    ),
  );

  /*
   * Und es muss im PROMPT stehen. handlungsdruck() für sich zu prüfen sagt
   * nichts darüber, ob Lukas es je zu sehen bekommt — eine Funktion, die
   * niemand aufruft, ist genau so folgenlos wie gar keine. (Die Gegenprobe
   * "Zeile aus getEmotionalContext entfernen" lief zuerst grün. Deshalb steht
   * das hier.)
   */
  globalThis.__emotionen = [
    { emotion: "scham", valence: -0.8, intensity: 0.9, cause: "Der Vorschlag war falsch", source: "tool", createdAt: new Date() },
  ];
  const promptBlock = await getEmotionalContext();
  pruefe("der Gefühlsblock nennt das Gefühl", promptBlock.includes("scham"));
  pruefe("und seine Ursache", promptBlock.includes("Der Vorschlag war falsch"));
  pruefe(
    "UND was daraus folgt — sonst ist das Gefühl Dekoration",
    /Was daraus folgt/.test(promptBlock) && /ueberspielen|überspielen/i.test(promptBlock),
  );

  // Der Charakter muss auf die NEUEN Namen reagieren.
  const emotion = (name, valence, intensity) => ({
    emotion: name,
    valence,
    intensity,
    cause: "",
    source: "tool",
    createdAt: new Date(),
  });

  globalThis.__charakter = { id: 1, traits: { confidence: 0.5, warmth: 0.5, guardedness: 0.3, playfulness: 0.5, ambition: 0.7 }, selfImage: "" };
  globalThis.__emotionen = Array.from({ length: 20 }, () => emotion("stolz", 0.8, 1));
  const nachStolz = await evolveCharacter();
  pruefe(
    "zwanzigmal Stolz hebt das Selbstvertrauen — der deutsche Name muss zählen",
    nachStolz.traits.confidence > 0.5,
  );

  globalThis.__charakter = { id: 1, traits: { confidence: 0.5, warmth: 0.5, guardedness: 0.3, playfulness: 0.5, ambition: 0.7 }, selfImage: "" };
  globalThis.__emotionen = Array.from({ length: 20 }, () => emotion("scham", -0.8, 1));
  const nachScham = await evolveCharacter();
  pruefe("zwanzigmal Scham senkt es", nachScham.traits.confidence < 0.5);
  pruefe("und macht ihn vorsichtiger", nachScham.traits.guardedness > 0.3);

  // Die alten englischen Namen dürfen dabei NICHT verlorengehen — in der
  // Datenbank liegen Wochen davon.
  globalThis.__charakter = { id: 1, traits: { confidence: 0.5, warmth: 0.5, guardedness: 0.3, playfulness: 0.5, ambition: 0.7 }, selfImage: "" };
  globalThis.__emotionen = Array.from({ length: 20 }, () => emotion("pride", 0.8, 1));
  pruefe("und die alten englischen Namen zählen weiterhin", (await evolveCharacter()).traits.confidence > 0.5);
}

if (fehler > 0) process.exit(1);
console.log(
  "OK — Gefühle: gleicher Ausgang, andere Lage, anderes Gefühl; Stärke folgt Erwartung, Ziel und Aufwand.",
);
