/**
 * Packt den fertigen Build in eine einzige HTML-Datei.
 *
 * Hintergrund: `vite build` erzeugt index.html plus getrennte JS- und
 * CSS-Dateien. Zum Verschicken oder Hochladen als einzelne Seite werden die
 * beiden Assets hier direkt ins Markup eingebettet. Einzige externe Ressource
 * bleiben die Google Fonts.
 *
 * Aufruf: npm run bundle --workspace=@workspace/landing-page
 * Ergebnis: dist/landingpage.html
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const distDir = path.resolve(import.meta.dirname, "..", "dist");

function findAsset(extension) {
  const dir = path.join(distDir, "assets");
  const match = readdirSync(dir).find((file) => file.endsWith(extension));
  if (!match) {
    throw new Error(`Keine ${extension}-Datei in dist/assets — erst "npm run build" ausführen.`);
  }
  return readFileSync(path.join(dir, match), "utf8");
}

const html = readFileSync(path.join(distDir, "index.html"), "utf8");
const css = findAsset(".css");
const js = findAsset(".js");

// </script> im Code würde das umschließende Script-Tag vorzeitig beenden.
const safeJs = js.replaceAll("</script", "<\\/script");

// Ersetzt wird ueber Funktionen, nicht ueber Strings: Zeichenfolgen wie $&
// oder $\' im Bundle wuerden sonst als Rueckverweise ausgewertet.
const bundled = html
  .replace(/<script type="module"[^>]*><\/script>/, () => `<script type="module">${safeJs}</script>`)
  .replace(/<link rel="stylesheet"[^>]*\/assets\/[^>]*>/, () => `<style>${css}</style>`);

if (bundled.includes("/assets/")) {
  throw new Error("Es sind noch Verweise auf /assets/ übrig — Einbettung unvollständig.");
}

const target = path.join(distDir, "landingpage.html");
writeFileSync(target, bundled);

const kb = Math.round(Buffer.byteLength(bundled) / 1024);
console.log(`dist/landingpage.html geschrieben (${kb} kB, eine Datei, keine Abhängigkeiten)`);
