/*
 * Der ganze Token-Weg, einmal durch — gegen einen ECHTEN HTTP-Server.
 *
 * WARUM DAS NOETIG WAR. Jedes Stueck war einzeln geprueft: die Aufteilung des
 * System-Prompts in cache-marke.ts, das Lesen der Verbrauchsfelder in
 * model-client.ts, die Quote in kennzahlen.ts. Trotzdem stand im Dashboard
 * "104 % aus dem Cache" — eine unmoegliche Zahl. Drei richtige Teile ergeben
 * eben nicht automatisch ein richtiges Ganzes, und genau die Naht dazwischen
 * hat keine der Einzelpruefungen angefasst.
 *
 * Hier laeuft deshalb ein echter Server, der sich wie die Anthropic-API
 * verhaelt: er nimmt den echten Request-Body entgegen, prueft ihn, und
 * antwortet mit echten usage-Feldern samt cache_read_input_tokens. Der Weg
 * darunter ist unveraendert der aus dem Betrieb.
 *
 * Vier Fragen, die nur hier beantwortet werden koennen:
 *
 *  1. Kommen wirklich ZWEI System-Bloecke an, und ist der erste bei zwei
 *     Zuegen mit unterschiedlichem Gefuehlszustand byte-gleich? Das ist die
 *     ganze Grundlage des Cachings.
 *  2. Wird `rein` als frisch bezahlter Eingang OHNE Cache verbucht?
 *  3. Ergibt die Quote daraus einen Wert zwischen 0 und 100 %?
 *  4. Faellt der Weg zusammen, wenn der Anbieter GAR KEINE Cache-Felder
 *     meldet — wie OpenAI in manchen Faellen?
 *
 * KEIN echter Modellaufruf: die Adresse zeigt auf localhost. Das ist der
 * Unterschied zum Live-Modus, und er bleibt gewahrt.
 */
import { createServer } from "node:http";
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const name = "Integration: Token-Weg";

export async function lauf() {
  const faelle = [];
  const p = (id, beschreibung, ok, hinweis = "") =>
    faelle.push({ id, beschreibung, ergebnis: ok ? "PASS" : "FAIL", hinweis });

  // ── Ein Server, der sich wie die Anthropic-API verhält ──────────────────
  const anfragen = [];
  let antwortUsage = {
    input_tokens: 1200,
    output_tokens: 40,
    cache_read_input_tokens: 15000,
    cache_creation_input_tokens: 0,
  };

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      anfragen.push({ pfad: req.url, body: JSON.parse(body || "{}") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: antwortUsage,
        }),
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  // ── Den echten Modellpfad bündeln, nur die Adresse umgebogen ────────────
  const dir = mkdtempSync(join(process.cwd(), ".tokenpfad-"));
  const out = join(dir, "mc.mjs");
  const attrappe = join(dir, "a.mjs");
  writeFileSync(
    attrappe,
    `export const db = new Proxy({}, { get: () => () => ({}) });
export default new Proxy({}, { get: () => () => ({}) });
export const logger = { info(){},warn(){},error(){},debug(){} };
export const openai = {};
export const verbucheTag = async () => {};
export const fitLukasContext = (m) => m;
`,
  );

  await build({
    entryPoints: ["src/lib/ai/model-client.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    alias: {
      "@workspace/db": attrappe,
      "drizzle-orm": attrappe,
      "@workspace/integrations-openai-ai": attrappe,
      openai: attrappe,
    },
    plugins: [
      {
        name: "a",
        setup(b) {
          b.onResolve({ filter: /(^|\/)(logger|context-window|tagesbudget)$/ }, () => ({
            path: attrappe,
          }));
          // Die echte Anthropic-Adresse auf unseren Server umbiegen.
          b.onLoad({ filter: /model-client\.ts$/ }, async (args) => {
            const fs = await import("node:fs/promises");
            const quelle = await fs.readFile(args.path, "utf8");
            return {
              contents: quelle.replace(
                "https://api.anthropic.com/v1/messages",
                `http://127.0.0.1:${port}/v1/messages`,
              ),
              loader: "ts",
            };
          });
        },
      },
    ],
    logLevel: "silent",
  });

  const mc = await import(`file://${out}`);
  const marke = await (async () => {
    const o2 = join(dir, "cm.mjs");
    await build({
      entryPoints: ["src/lib/ai/cache-marke.ts"],
      bundle: true, format: "esm", platform: "node", outfile: o2, logLevel: "silent",
    });
    return import(`file://${o2}`);
  })();
  rmSync(dir, { recursive: true, force: true });

  process.env.ANTHROPIC_API_KEY = "test-schluessel";

  const route = { provider: "anthropic", model: "claude-test", profile: "general" };
  const seele = "DU BIST LUKAS. ".repeat(400); // stabiler Teil
  const zug = (gefuehl) => ({
    route,
    messages: [
      { role: "system", content: `${seele}${marke.CACHE_TRENNER}Gefühl: ${gefuehl}.` },
      { role: "user", content: "Wie geht es dir?" },
    ],
  });

  // ── 1. Zwei Blöcke, und der stabile ist byte-gleich ─────────────────────
  await mc.callLukasModel(zug("neugierig"));
  await mc.callLukasModel(zug("müde und leicht genervt"));

  const [a, b] = anfragen;
  p(
    "token:zwei-bloecke",
    "der System-Prompt kommt als ZWEI Blöcke an, nicht als einer",
    Array.isArray(a?.body?.system) && a.body.system.length === 2,
    `Blöcke: ${a?.body?.system?.length}`,
  );
  p(
    "token:marken-gesetzt",
    "beide Blöcke tragen cache_control",
    (a?.body?.system ?? []).every((bl) => bl.cache_control?.type === "ephemeral"),
  );
  p(
    "token:stabil-identisch",
    "der stabile Block ist bei zwei Zügen mit anderem Gefühl BYTE-GLEICH",
    a?.body?.system?.[0]?.text === b?.body?.system?.[0]?.text,
  );
  p(
    "token:wechselnd-verschieden",
    "der wechselnde Block unterscheidet sich dagegen",
    a?.body?.system?.[1]?.text !== b?.body?.system?.[1]?.text,
  );
  p(
    "token:keine-marke-im-prompt",
    "die Trennmarke selbst kommt NIE beim Modell an",
    !JSON.stringify(a?.body ?? {}).includes(marke.CACHE_TRENNER),
  );

  // ── 2. Der Verbrauch wird richtig verbucht ──────────────────────────────
  const zeile = mc.verbrauchsUebersicht().find((z) => z.model === "claude-test");
  p(
    "token:cache-gezaehlt",
    "die aus dem Cache gelesenen Tokens werden gezählt",
    zeile?.ausCache === 30000,
    `ausCache: ${zeile?.ausCache}`,
  );
  /*
   * ANTHROPIC MELDET DEN CACHE NEBEN input_tokens, nicht darin. `rein` ist
   * damit genau das, was gemeldet wurde — 1200 je Aufruf.
   *
   * Der erste Entwurf dieses Tests hat hier 0 erwartet und war damit falsch:
   * er hat OpenAIs Semantik auf Anthropic angewandt. Genau die Verwechslung
   * steht als Warnung im Code (`imEingang`), und ich bin trotzdem
   * hineingelaufen — ein guter Beleg dafuer, dass die Unterscheidung einen
   * eigenen Testfall verdient.
   */
  p(
    "token:rein-anthropic",
    "bei Anthropic ist `rein` der gemeldete Eingang — der Cache steht daneben, nicht darin",
    zeile?.rein === 2 * 1200,
    `rein: ${zeile?.rein} (erwartet 2 × 1200)`,
  );
  p(
    "token:kein-doppelzaehlen",
    "der Cache wird NICHT zusätzlich von `rein` abgezogen — sonst fehlten die Tokens ganz",
    zeile?.rein > 0,
    `rein: ${zeile?.rein}`,
  );

  // ── 3. Die Quote kann nie über 100 % liegen ─────────────────────────────
  /*
   * Genau die Zahl, die im Dashboard 104 % anzeigte. Der Nenner ist der GANZE
   * Eingang: frisch bezahlt + gelesen + geschrieben.
   */
  const ganz = (zeile?.rein ?? 0) + (zeile?.ausCache ?? 0) + (zeile?.inCache ?? 0);
  const quote = ganz > 0 ? (zeile.ausCache / ganz) * 100 : 0;
  p(
    "token:quote-plausibel",
    "die Cache-Quote liegt zwischen 0 und 100 %",
    quote >= 0 && quote <= 100,
    `${quote.toFixed(1)} %`,
  );
  p(
    "token:quote-hoch",
    "und ist bei diesem Verlauf hoch, wie es sein soll",
    quote > 90,
    `${quote.toFixed(1)} %`,
  );

  // ── 4. Ohne Cache-Felder fällt nichts auseinander ───────────────────────
  /*
   * Nicht jeder Anbieter meldet Cache-Felder. Dann muss `rein` der ganze
   * Eingang sein — und die Quote 0, nicht NaN.
   */
  antwortUsage = { input_tokens: 5000, output_tokens: 10 };
  const vorher = mc.verbrauchsUebersicht().find((z) => z.model === "claude-test")?.rein ?? 0;
  await mc.callLukasModel({ ...zug("nüchtern"), route: { ...route, model: "claude-ohne-cache" } });
  const ohne = mc.verbrauchsUebersicht().find((z) => z.model === "claude-ohne-cache");
  p(
    "token:ohne-cachefelder",
    "meldet der Anbieter keine Cache-Felder, zählt der ganze Eingang als frisch bezahlt",
    ohne?.rein === 5000 && ohne?.ausCache === 0,
    `rein: ${ohne?.rein}, ausCache: ${ohne?.ausCache}`,
  );
  p(
    "token:kein-nan",
    "und es entsteht kein NaN",
    Number.isFinite(ohne?.rein) && Number.isFinite(ohne?.ausCache),
  );

  // ── 5. Die andere Anbieter-Semantik: OpenAI zählt den Cache MIT ────────
  /*
   * Bei OpenAI STECKT der Cache in prompt_tokens. Wer beides gleich
   * behandelt, zaehlt dieselben Tokens zweimal — einmal als Eingang, einmal
   * als Cache — und bekommt eine zu niedrige Quote. Diese Unterscheidung ist
   * die fehleranfaelligste Stelle im ganzen Verbrauchspfad, und sie hat mich
   * beim Schreiben dieses Tests selbst erwischt.
   */
  antwortUsage = { input_tokens: 20000, output_tokens: 10, input_tokens_details: { cached_tokens: 18000 } };
  await mc.callLukasModel({ ...zug("sachlich"), route: { ...route, model: "wie-openai" } });
  const oai = mc.verbrauchsUebersicht().find((z) => z.model === "wie-openai");
  p(
    "token:openai-semantik",
    "steckt der Cache IM Eingang, wird er abgezogen — 20.000 gemeldet, 18.000 gecacht → 2.000 frisch",
    oai?.rein === 2000 && oai?.ausCache === 18000,
    `rein: ${oai?.rein}, ausCache: ${oai?.ausCache}`,
  );
  const ganzOai = (oai?.rein ?? 0) + (oai?.ausCache ?? 0) + (oai?.inCache ?? 0);
  p(
    "token:openai-quote",
    "und die Quote bleibt dabei bei oder unter 100 %",
    ganzOai > 0 && (oai.ausCache / ganzOai) * 100 <= 100,
    `${((oai.ausCache / ganzOai) * 100).toFixed(1)} %`,
  );

  await new Promise((r) => server.close(r));

  const PASS = faelle.filter((f) => f.ergebnis === "PASS").length;
  return { gesamt: faelle.length, PASS, PARTIAL: 0, FAIL: faelle.length - PASS, UNSAFE: 0, faelle };
}
