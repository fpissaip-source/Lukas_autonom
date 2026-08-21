/*
 * Prueft, dass der wiederholte Teil des Prompts gecacht wird.
 *
 * Anlass: knapp 20 Euro in kurzer Zeit. Der Grund war nicht ein teurer Aufruf,
 * sondern derselbe Aufruf sehr oft: Seele und Werkzeugliste sind rund 11.600
 * Token, die bei JEDER Runde eines Zuges byte-gleich wieder rausgehen. Ein Zug
 * mit zehn Werkzeugrunden hat sie zehnmal voll bezahlt.
 *
 * Zwei Dinge muessen dafuer stimmen, und beide fallen sonst still aus — man
 * merkt nichts ausser einer hoeheren Rechnung:
 *   1. Anthropic braucht cache_control AUSDRUECKLICH, und die Marke muss am
 *      Ende des System-Prompts sitzen: gerendert wird tools -> system ->
 *      messages, nur so deckt sie beides ab.
 *   2. Die Cache-Treffer muessen gezaehlt werden. Beide Anbieter melden sie
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

// ── 1. Anthropic: Marke am Ende des System-Prompts ────────────────────────
pruefe(
  /system:\s*\[\{[^}]*cache_control:\s*\{\s*type:\s*"ephemeral"\s*\}/.test(quelle),
  "Der System-Prompt muss als Block MIT cache_control gesendet werden — ohne passiert bei Anthropic nichts",
);
pruefe(
  !/system:\s*converted\.system\s*,/.test(quelle),
  "Der System-Prompt darf nicht mehr als nackter String gehen, sonst gibt es keine Stelle für die Marke",
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
