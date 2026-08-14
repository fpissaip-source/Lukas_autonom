/*
 * Prueft das Lesen des Chat-Streams gegen den Fall, an dem er wirklich
 * gescheitert ist: eine lange Antwort, die auf mehrere Netzwerk-Happen
 * verteilt ankommt. Vorher ging genau die verloren.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".sse-check-"));
const out = join(dir, "sse.mjs");

await build({
  entryPoints: ["src/lib/sse.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  logLevel: "silent",
});

const { takeCompleteLines, parseSseData } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

/** Liest einen Stream so, wie der Chat es tut. */
function lesen(happen) {
  let puffer = "";
  const texte = [];
  const werkzeuge = [];
  let fehler = null;
  let fertig = false;

  for (const h of happen) {
    puffer += h;
    const { zeilen, rest } = takeCompleteLines(puffer);
    puffer = rest;
    for (const zeile of zeilen) {
      const p = parseSseData(zeile);
      if (!p) continue;
      if (p.content) texte.push(String(p.content));
      if (p.tool) werkzeuge.push(String(p.tool));
      if (p.error) fehler = String(p.error);
      if (p.done) fertig = true;
    }
  }
  return { text: texte.join(""), werkzeuge, fehler, fertig, offen: puffer };
}

const lang = "Ja, ich habe es analysiert. ".repeat(400);
const rahmen =
  `data: ${JSON.stringify({ tool: "fetch_url" })}\n\n` +
  `: ping\n\n` +
  `data: ${JSON.stringify({ content: lang })}\n\n` +
  `data: ${JSON.stringify({ done: true })}\n\n`;

/** Den fertigen Stream in Stuecke schneiden, wie das Netz es tut. */
function zerlegen(text, groesse) {
  const teile = [];
  for (let i = 0; i < text.length; i += groesse) teile.push(text.slice(i, i + groesse));
  return teile;
}

let fehler = 0;
const pruefe = (name, bedingung) => {
  if (!bedingung) {
    console.error(`FEHLER: ${name}`);
    fehler++;
  }
};

// Der eigentliche Fall: die lange Antwort kommt in vielen kleinen Stuecken.
for (const groesse of [1, 7, 64, 512, 4096, rahmen.length]) {
  const r = lesen(zerlegen(rahmen, groesse));
  pruefe(`Happen à ${groesse}: Text vollstaendig`, r.text === lang);
  pruefe(`Happen à ${groesse}: Werkzeug erkannt`, r.werkzeuge.join() === "fetch_url");
  pruefe(`Happen à ${groesse}: Abschluss erkannt`, r.fertig === true);
  pruefe(`Happen à ${groesse}: nichts haengt im Puffer`, r.offen === "");
}

// Lebenszeichen duerfen nichts ausloesen.
const nurPing = lesen([": ping\n\n", ": ping\n\n"]);
pruefe("Lebenszeichen erzeugen keinen Text", nurPing.text === "" && !nurPing.fertig);

// Ein Fehler muss ankommen statt verschluckt zu werden.
const mitFehler = lesen(zerlegen(`data: ${JSON.stringify({ error: "Modell weg" })}\n\n`, 5));
pruefe("Fehler kommt an", mitFehler.fehler === "Modell weg");

// Eine kaputte Zeile darf den Rest nicht mitreissen.
const kaputt = lesen([`data: {kaputt\n\ndata: ${JSON.stringify({ content: "ok" })}\n\n`]);
pruefe("Kaputte Zeile stoppt den Stream nicht", kaputt.text === "ok");

if (fehler > 0) process.exit(1);
console.log("OK — Chat-Stream: alle Fälle korrekt, auch bei zerstückelten Paketen.");
