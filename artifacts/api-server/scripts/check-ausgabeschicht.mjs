/*
 * Prueft die Stelle, an der Lukas' Antworten verschwunden sind.
 *
 * Der Fehler: renderLukasVoice bekam den kompletten Verlauf mitsamt der
 * Assistenten-Nachrichten MIT tool_calls und der tool-Ergebnisse — obwohl
 * dieser Aufruf bewusst KEINE Werkzeuge hat, er soll nur formulieren.
 *
 * Unter chat.completions war das folgenlos. Seit der Responses-API nicht mehr:
 * dort werden aus tool_calls eigene function_call-Elemente, und die weist die
 * API zurueck, wenn im selben Aufruf keine Werkzeuge definiert sind. Jeder Zug,
 * in dem Lukas auch nur EIN Werkzeug benutzt hat, ist damit im letzten Schritt
 * gescheitert — nach getaner Arbeit, kurz vor der Antwort. Ein reines Gespraech
 * kam durch, und genau das sah aus wie "sporadisch".
 *
 * Zwei Dinge werden hier festgehalten:
 *  1. In einen werkzeuglosen Aufruf gelangt kein einziges Werkzeug-Element.
 *  2. Scheitert der Aufruf trotzdem, geht der Entwurf raus. Eine unpolierte
 *     Antwort ist unendlich viel besser als keine.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".ausgabe-check-"));
const out = join(dir, "voice.mjs");

/*
 * Ein OpenAI-Ersatz, der nicht antwortet, sondern mitschreibt: die Pruefung
 * will sehen, WAS rausgegangen waere. Ein echter Aufruf wuerde nur sagen, dass
 * es klappt oder nicht — nicht, warum.
 */
const attrappe = join(dir, "attrappe.mjs");
writeFileSync(
  attrappe,
  `globalThis.__gesendet = [];
globalThis.__sollScheitern = false;
export const openai = {
  responses: {
    create: async (req) => {
      globalThis.__gesendet.push(req);
      if (globalThis.__sollScheitern) {
        throw new Error("400 No tool output found for function call");
      }
      return { output: [], output_text: "Poliert.", status: "completed" };
    },
  },
};
export const logger = { info() {}, warn() {}, error() {} };
`,
);

await build({
  entryPoints: ["src/lib/ai/voice-renderer.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/integrations-openai-ai": attrappe },
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: attrappe }));
      },
    },
  ],
  logLevel: "silent",
});

const { renderLukasVoice } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

/** Genau der Verlauf, an dem es gescheitert ist: Werkzeug benutzt, dann Antwort. */
const verlaufMitWerkzeug = [
  { role: "system", content: "Du bist Lukas." },
  { role: "user", content: "Schau dir die Seite an." },
  {
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "call_1", type: "function", function: { name: "browse_page", arguments: '{"url":"https://x.test"}' } },
    ],
  },
  { role: "tool", tool_call_id: "call_1", content: "Seiteninhalt …" },
  { role: "assistant", content: "Ich habe sie gelesen." },
];

globalThis.__gesendet = [];
globalThis.__sollScheitern = false;

const antwort = await renderLukasVoice({
  systemPrompt: "Du bist Lukas.",
  conversation: verlaufMitWerkzeug,
  draft: "Die Seite zeigt drei Clips.",
});

pruefe("es wurde genau ein Aufruf gemacht", globalThis.__gesendet.length === 1);

const req = globalThis.__gesendet[0] ?? {};
const eingabe = JSON.stringify(req.input ?? []);

pruefe("der Aufruf hat keine Werkzeuge", !req.tools || req.tools.length === 0);
pruefe("und deshalb auch KEIN function_call", !eingabe.includes("function_call"));
pruefe("und kein function_call_output", !eingabe.includes("function_call_output"));
pruefe("der Entwurf ist trotzdem drin", eingabe.includes("Die Seite zeigt drei Clips"));
pruefe("und der Dialog auch", eingabe.includes("Schau dir die Seite an"));
pruefe("die polierte Antwort kommt zurück", antwort === "Poliert.");

// Scheitert der Aufruf, darf die Antwort NICHT verloren gehen.
globalThis.__gesendet = [];
globalThis.__sollScheitern = true;

const trotzdem = await renderLukasVoice({
  systemPrompt: "Du bist Lukas.",
  conversation: verlaufMitWerkzeug,
  draft: "Die Seite zeigt drei Clips.",
});
pruefe("bei einem Fehler geht der Entwurf raus", trotzdem === "Die Seite zeigt drei Clips.");

// Ohne Entwurf gibt es nichts zu formulieren — und keinen Aufruf.
globalThis.__gesendet = [];
globalThis.__sollScheitern = false;
const leer = await renderLukasVoice({
  systemPrompt: "Du bist Lukas.",
  conversation: verlaufMitWerkzeug,
  draft: "   ",
});
pruefe("ohne Entwurf keine Antwort", leer === "");
pruefe("und kein unnötiger Aufruf", globalThis.__gesendet.length === 0);

if (fehler > 0) process.exit(1);
console.log("OK — Ausgabeschicht: keine Werkzeug-Elemente im werkzeuglosen Aufruf, Antwort geht nie verloren.");
