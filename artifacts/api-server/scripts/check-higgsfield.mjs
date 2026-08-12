/*
 * Prueft die Higgsfield-Modellwahl.
 *
 * Hintergrund: das Studio hat drei alte REST-Pfade als Modellnamen gefuehrt
 * ("higgsfield-ai/soul/standard" usw.), die es im MCP-Katalog nicht gibt. Jede
 * Generierung ueber MCP lief damit in einen Fehler. Diese Pruefung haelt fest,
 * dass alte Namen uebersetzt werden und nie ein unbekannter Name durchrutscht.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".higgsfield-check-"));
const out = join(dir, "models.mjs");

await build({
  entryPoints: ["src/lib/higgsfield-models.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  logLevel: "silent",
});

const { resolveHiggsfieldModel, higgsfieldMediaType, HIGGSFIELD_MODELS } = await import(
  `file://${out}`
);
rmSync(dir, { recursive: true, force: true });

const gueltig = new Set([
  ...HIGGSFIELD_MODELS.image.map((m) => m.id),
  ...HIGGSFIELD_MODELS.video.map((m) => m.id),
]);

const faelle = [
  // Alte REST-Pfade, die real im Code standen.
  ["video", "bytedance/seedance/v1/pro/image-to-video", "seedance_2_5"],
  ["video", "kling-video/v2.1/pro/image-to-video", "kling3_0"],
  ["image", "higgsfield-ai/soul/standard", "soul_2"],
  // Ein Bildmodell darf beim Video nicht stehenbleiben.
  ["video", "higgsfield-ai/soul/standard", "seedance_2_5"],
  // Katalog-IDs bleiben, wie sie sind.
  ["video", "seedance_2_5", "seedance_2_5"],
  ["image", "nano_banana_pro", "nano_banana_pro"],
  ["image", "marketing_studio_image", "marketing_studio_image"],
  // Unbekanntes und Leeres faellt auf den Standard.
  ["video", "irgendwas-erfundenes", "seedance_2_5"],
  ["image", "", "soul_2"],
  ["image", null, "soul_2"],
  // Medientyp aus der ID, nicht aus dem Wort "video" im Namen.
  ["typ", "seedance_2_5", "video"],
  ["typ", "soul_2", "image"],
  ["typ", "bytedance/seedance/v1/pro/image-to-video", "video"],
];

let fehler = 0;
for (const [typ, eingabe, erwartet] of faelle) {
  const ist = typ === "typ" ? higgsfieldMediaType(eingabe) : resolveHiggsfieldModel(typ, eingabe);
  if (ist !== erwartet) {
    console.error(`FEHLER ${typ} "${eingabe}": erwartet ${erwartet}, war ${ist}`);
    fehler++;
  }
  if (typ !== "typ" && !gueltig.has(ist)) {
    console.error(`FEHLER "${eingabe}" ergab die unbekannte ID ${ist}`);
    fehler++;
  }
}

if (fehler > 0) process.exit(1);
console.log(`OK — Modellwahl: ${faelle.length} Fälle korrekt.`);
