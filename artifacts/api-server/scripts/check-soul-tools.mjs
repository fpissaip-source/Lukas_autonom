#!/usr/bin/env node
/*
 * Prueft, dass jedes Tool aus LUKAS_TOOLS auch in Lukas' Seele
 * (lukas-soul.ts) beschrieben ist.
 *
 * Hintergrund: Tools wurden eingebaut, aber die Faehigkeitsliste im
 * System-Prompt nicht mitgepflegt. Ergebnis: Lukas hatte GitHub-, E-Mail- und
 * Shell-Zugriff, behauptete aber im Chat, er habe "keine Coding-Rechte" — er
 * liest seine eigene Liste und glaubt ihr mehr als der Tool-Definition.
 *
 * Aufruf: node scripts/check-soul-tools.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsSrc = readFileSync(path.join(here, "../src/lib/lukas-tools.ts"), "utf8");
const soulSrc = readFileSync(path.join(here, "../src/lib/lukas-soul.ts"), "utf8");

const toolNames = [...toolsSrc.matchAll(/^\s{6}name: "([a-z_]+)"/gm)].map((m) => m[1]);
if (toolNames.length === 0) {
  console.error("Keine Tools gefunden — hat sich das Format in lukas-tools.ts geaendert?");
  process.exit(1);
}

const missing = toolNames.filter((name) => !soulSrc.includes(name));

if (missing.length > 0) {
  console.error(
    `FEHLT in lukas-soul.ts (Lukas weiss dann nicht, dass er das kann):\n` +
      missing.map((m) => `  - ${m}`).join("\n"),
  );
  process.exit(1);
}

console.log(`OK — alle ${toolNames.length} Tools sind in Lukas' Seele beschrieben.`);
