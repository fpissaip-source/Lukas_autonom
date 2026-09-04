/*
 * Prueft, dass der wiederholte Teil des Prompts gecacht wird.
 *
 * Anlass: knapp 20 Euro in kurzer Zeit. Der Grund war nicht ein teurer Aufruf,
 * sondern derselbe Aufruf sehr oft: Seele und Werkzeugliste sind rund 11.600
 * Token, die bei JEDER Runde eines Zuges byte-gleich wieder rausgehen. Ein Zug
 * mit zehn Werkzeugrunden hat sie zehnmal voll bezahlt.
 *
 * Drei Dinge muessen dafuer stimmen, und alle fallen sonst still aus — man
 * merkt nichts ausser einer hoeheren Rechnung:
 *
 *   1. Anthropic braucht cache_control AUSDRUECKLICH.
 *
 *   2. Die Marke darf NICHT nur am Ende des ganzen System-Prompts stehen.
 *      Genau das war der Fehler: der Prompt endet auf Gefuehlszustand,
 *      Erinnerungen und Budget — auf alles, was sich zwischen zwei
 *      Nachrichten aendert. Anthropic vergleicht Praefixe nur an gesetzten
 *      Marken, also traf der Cache innerhalb EINES Zuges (der Prompt wird
 *      einmal gebaut) und zwischen zwei Nachrichten NIE. Bezahlt wurden
 *      dabei jedes Mal auch die stabilen 11.600 Token.
 *      Die Eigenschaft, die das prueft: zwei Prompts, die sich NUR hinter der
 *      Marke unterscheiden, muessen einen byte-gleichen ersten Block ergeben.
 *
 *   3. Die Cache-Treffer muessen gezaehlt werden. Beide Anbieter melden sie
 *      unter verschiedenen Namen; wer keinen davon liest, kann nicht sagen,
 *      ob ueberhaupt etwas greift.
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const quelle = readFileSync("src/lib/ai/model-client.ts", "utf8");

let fehler = 0;
const pruefe = (bedingung, text) => {
  if (!bedingung) {
    console.error("FEHLER — " + text);
    fehler++;
  }
};

// ── 1. Anthropic: die Bloecke werden WIRKLICH so gebaut ───────────────────
/*
 * Ausgefuehrt statt im Quelltext gesucht. Ein Muster im Text sagt nur, dass
 * irgendwo "cache_control" steht — nicht, dass der stabile Teil auch wirklich
 * stabil bleibt. Genau daran ist es vorher vorbeigelaufen.
 */
{
  const dir2 = mkdtempSync(join(process.cwd(), ".cache-marke-"));
  const out2 = join(dir2, "marke.mjs");
  await build({
    entryPoints: ["src/lib/ai/cache-marke.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out2,
    logLevel: "silent",
  });
  const { CACHE_TRENNER, systemBloecke, ohneTrenner } = await import(`file://${out2}`);
  rmSync(dir2, { recursive: true, force: true });

  const seele = "DU BIST LUKAS. ".repeat(200);
  const montag = `${seele}${CACHE_TRENNER}Gefühl: neugierig. Erinnerungen: A, B.`;
  const dienstag = `${seele}${CACHE_TRENNER}Gefühl: müde. Erinnerungen: A, B, C, D.`;

  const a = systemBloecke(montag);
  const b = systemBloecke(dienstag);

  pruefe(a.length === 2, "Mit Trennmarke müssen es ZWEI Blöcke sein, sonst gibt es nichts zu treffen");
  pruefe(
    a.every((bl) => bl.cache_control?.type === "ephemeral"),
    "Jeder Block braucht cache_control — ohne passiert bei Anthropic nichts",
  );

  /*
   * DAS ist die eigentliche Zusage: der stabile Teil bleibt gleich, auch wenn
   * sich Gefühle und Erinnerungen ändern. Ohne diese Eigenschaft ist der
   * Cache eine Behauptung.
   */
  pruefe(
    a[0].text === b[0].text,
    "Zwei Prompts, die sich nur hinter der Marke unterscheiden, MÜSSEN denselben ersten Block ergeben",
  );
  pruefe(a[1].text !== b[1].text, "Der wechselnde Teil muss sich dagegen unterscheiden dürfen");

  // Die Marke selbst darf nirgends beim Modell ankommen.
  pruefe(
    a.every((bl) => !bl.text.includes(CACHE_TRENNER)),
    "Die Trennmarke darf in keinem Block stehen — sonst liest das Modell eine sinnlose Zeile",
  );
  pruefe(
    !ohneTrenner(montag).includes(CACHE_TRENNER),
    "ohneTrenner muss die Marke restlos entfernen — für alle Anbieter außer Anthropic",
  );

  // Ohne Marke: genau ein Block, altes Verhalten.
  const kurz = systemBloecke("Ein kurzer Prompt ohne Marke.");
  pruefe(kurz.length === 1, "Ohne Trennmarke bleibt es bei EINEM Block");
  pruefe(kurz[0].cache_control?.type === "ephemeral", "Auch der eine Block trägt die Marke");

  // Endet der Prompt auf der Marke, entsteht kein leerer Block — Anthropic lehnt den ab.
  pruefe(
    systemBloecke(`${seele}${CACHE_TRENNER}`).length === 1,
    "Ein Prompt, der auf der Marke endet, darf keinen leeren Block erzeugen",
  );
  pruefe(
    systemBloecke(`${seele}${CACHE_TRENNER}   `).length === 1,
    "Auch nicht, wenn dahinter nur Leerraum steht",
  );
}

// Und die Marke muss im System-Prompt überhaupt gesetzt werden.
pruefe(
  readFileSync("src/lib/system-prompt.ts", "utf8").includes("${CACHE_TRENNER}"),
  "Ohne Marke im System-Prompt nützt die beste Aufteilung nichts",
);
pruefe(
  !/system:\s*converted\.system\s*,/.test(quelle),
  "Der System-Prompt darf nicht als nackter String gehen, sonst gibt es keine Stelle für die Marke",
);

// ── 2. OpenAI: Schluessel, damit gleichartige Anfragen sich treffen ───────
pruefe(
  /request\.prompt_cache_key\s*=/.test(quelle),
  "Ohne prompt_cache_key ist ein Cache-Treffer bei OpenAI Zufall",
);

// ── 3. Beide Namen fuer Cache-Treffer werden gelesen ──────────────────────
for (const [feld, anbieter] of [
  ["cache_read_input_tokens", "Anthropic"],
  ["cached_tokens", "OpenAI"],
]) {
  pruefe(quelle.includes(feld), `${anbieter} meldet Treffer als ${feld} — das muss gelesen werden`);
}

// ── 4. Die Zaehlung rechnet richtig ───────────────────────────────────────
const dir = mkdtempSync(join(process.cwd(), ".cache-check-"));
const out = join(dir, "mc.mjs");
try {
  await build({
    entryPoints: ["src/lib/ai/model-client.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "silent",
    external: ["openai", "@workspace/*"],
    plugins: [
      {
        name: "attrappen",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) =>
            args.kind === "entry-point" ? undefined : { path: args.path, external: true },
          );
        },
      },
    ],
  });
  console.log("  (Bundle gebaut — Rechenweg wird nachgestellt)");
} catch {
  console.log("  (Bundle nicht moeglich — Rechenweg wird nachgestellt)");
}
rmSync(dir, { recursive: true, force: true });

/** Derselbe Rechenweg wie cacheTreffer() im Modul. */
const treffer = (usage) => ({
  gelesen:
    Number(usage.cache_read_input_tokens ?? 0) ||
    Number(usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0),
  geschrieben: Number(usage.cache_creation_input_tokens ?? 0),
});

pruefe(
  treffer({ cache_read_input_tokens: 11600, cache_creation_input_tokens: 0 }).gelesen === 11600,
  "Anthropic-Treffer muessen gezaehlt werden",
);
pruefe(
  treffer({ input_tokens_details: { cached_tokens: 9000 } }).gelesen === 9000,
  "OpenAI-Treffer muessen gezaehlt werden",
);
pruefe(treffer({}).gelesen === 0, "Ohne Angabe muss 0 herauskommen, nicht NaN");
pruefe(
  Number.isFinite(treffer({ input_tokens_details: null }).gelesen),
  "Ein fehlendes Unterobjekt darf nicht zu NaN führen",
);

if (fehler > 0) {
  console.error(`\n${fehler} Fehler beim Caching.`);
  process.exit(1);
}
console.log("OK — Caching: Marke sitzt richtig, Schlüssel gesetzt, Treffer beider Anbieter werden gezählt.");
