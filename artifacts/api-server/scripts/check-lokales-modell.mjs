/*
 * Prueft, dass Lukas ein lokales/selbst gehostetes Modell wirklich benutzen
 * kann — gegen einen echten HTTP-Server, nicht gegen eine Attrappe.
 *
 * Der Server hier spricht die OpenAI-Schnittstelle, genau wie Ollama,
 * llama.cpp, vLLM oder LM Studio. Wenn Lukas mit DIESEM redet, redet er auch
 * mit denen.
 *
 * Zwei Punkte, an denen so eine Anbindung typischerweise scheitert und die
 * deshalb hier festgehalten werden:
 *  - Werkzeugaufrufe. Ein Modell ohne Werkzeuge ist fuer Lukas nutzlos.
 *  - Der Rueckfall. Ist der lokale Server aus, muss OpenAI uebernehmen —
 *    ein abgeschaltetes Ollama darf Lukas nicht lahmlegen.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";

const dir = mkdtempSync(join(process.cwd(), ".lokal-check-"));
const out = join(dir, "client.mjs");

const attrappe = join(dir, "attrappe.mjs");
writeFileSync(
  attrappe,
  `globalThis.__openaiAufrufe ??= 0;
export const openai = {
  responses: {
    create: async () => {
      globalThis.__openaiAufrufe++;
      return { output: [], output_text: "von OpenAI", status: "completed" };
    },
  },
};
export const logger = { info() {}, warn() {}, error() {} };
`,
);

await build({
  entryPoints: ["src/lib/ai/model-client.ts"],
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

/** Ein Server, wie Ollama ihn bereitstellt. Merkt sich, was ankam. */
let letzteAnfrage = null;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    letzteAnfrage = { pfad: req.url, kopf: req.headers, inhalt: JSON.parse(body || "{}") };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Antwort vom lokalen Modell",
              tool_calls: [
                // Ohne "type" — manche Server lassen es weg.
                { id: "call_a", function: { name: "web_search", arguments: '{"query":"test"}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const { callLukasModel } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${was}`);
    fehler++;
  }
};

process.env.LUKAS_LOCAL_BASE_URL = `http://127.0.0.1:${port}/v1`;

const ergebnis = await callLukasModel({
  route: { provider: "local", model: "kimi-k2", profile: "general", reason: "Test" },
  messages: [{ role: "user", content: "Hallo" }],
  tools: [
    {
      type: "function",
      function: { name: "web_search", description: "sucht", parameters: { type: "object", properties: {} } },
    },
  ],
});

pruefe("der lokale Server wurde gefragt, nicht OpenAI", globalThis.__openaiAufrufe === 0);
pruefe("und zwar unter /v1/chat/completions", letzteAnfrage?.pfad === "/v1/chat/completions");
pruefe("das Modell wird durchgereicht", letzteAnfrage?.inhalt.model === "kimi-k2");
pruefe("die Werkzeuge auch", letzteAnfrage?.inhalt.tools?.length === 1);
pruefe("ohne Schlüssel kein Authorization-Header", !letzteAnfrage?.kopf.authorization);
pruefe("die Antwort kommt an", ergebnis.content === "Antwort vom lokalen Modell");
pruefe("und der Werkzeugaufruf auch", ergebnis.toolCalls[0]?.name === "web_search");
pruefe("mit seinen Argumenten", ergebnis.toolCalls[0]?.arguments.includes("test"));

// Mit Schluessel muss der Header gesetzt sein.
process.env.LUKAS_LOCAL_API_KEY = "geheim";
await callLukasModel({
  route: { provider: "local", model: "kimi-k2", profile: "general", reason: "Test" },
  messages: [{ role: "user", content: "Hallo" }],
});
pruefe("mit Schlüssel wird er mitgeschickt", letzteAnfrage?.kopf.authorization === "Bearer geheim");
delete process.env.LUKAS_LOCAL_API_KEY;

/*
 * Der wichtigste Fall: der lokale Server ist weg. Lukas darf davon nicht
 * stehenbleiben — er wird nur wieder teurer.
 */
await new Promise((r) => server.close(r));
globalThis.__openaiAufrufe = 0;

const trotzdem = await callLukasModel({
  route: { provider: "local", model: "kimi-k2", profile: "general", reason: "Test" },
  messages: [{ role: "user", content: "Hallo" }],
});
pruefe("bei totem lokalen Server springt OpenAI ein", globalThis.__openaiAufrufe === 1);
pruefe("und es kommt eine Antwort", trotzdem.content === "von OpenAI");

if (fehler > 0) process.exit(1);
console.log("OK — Lokales Modell: Aufruf, Werkzeuge und Rückfall auf OpenAI korrekt.");
