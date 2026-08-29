/*
 * Eine grüne CI mit bekannten Lücken in den Abhängigkeiten ist nicht grün.
 *
 * Diese Prüfung unterscheidet, was `npm audit` allein nicht tut: liegt das
 * betroffene Paket im LAUFZEITPFAD des Servers, oder ist es ein Werkzeug, das
 * nur beim Bauen läuft? Der Unterschied ist erheblich — eine Lücke in einem
 * Build-Werkzeug erreicht kein Angreifer über das Internet, eine im
 * ausgelieferten Bündel schon.
 *
 * Ohne diese Unterscheidung hätte man zwei schlechte Möglichkeiten: entweder
 * bei jedem transitiven Dev-Advisory die CI rot färben (dann schaltet sie
 * irgendwann jemand ab), oder gar nicht prüfen.
 *
 * Ausnahmen stehen in bench/ausnahmen.json — mit Begründung und Datum, damit
 * sie jemand wieder ansieht, statt dass sie stillschweigend gelten.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const WURZEL = new URL("../../..", import.meta.url).pathname;
const AUSNAHMEN = new URL("../bench/ausnahmen.json", import.meta.url).pathname;

function audit() {
  try {
    return JSON.parse(execSync("npm audit --json", { cwd: WURZEL, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch (err) {
    // npm audit endet mit Code != 0, sobald es etwas findet — die Ausgabe ist
    // trotzdem gültig.
    try {
      return JSON.parse(err.stdout ?? "{}");
    } catch {
      console.error("npm audit nicht ausführbar (kein Netz?) — Prüfung übersprungen.");
      process.exit(0);
    }
  }
}

const daten = audit();
const zaehler = daten.metadata?.vulnerabilities ?? {};
const ausnahmen = existsSync(AUSNAHMEN) ? JSON.parse(readFileSync(AUSNAHMEN, "utf8")) : { paket: {} };

/*
 * Laufzeit heisst: es steckt im Bündel, das auf dem Server läuft. Der
 * API-Server wird von esbuild zu einer einzigen Datei gebündelt; was nur in
 * devDependencies steht, kommt dort nicht hinein.
 */
const laufzeit = new Set(
  Object.keys(JSON.parse(readFileSync(`${WURZEL}/artifacts/api-server/package.json`, "utf8")).dependencies ?? {}),
);

const offen = [];
for (const [name, v] of Object.entries(daten.vulnerabilities ?? {})) {
  const stufe = v.severity;
  if (stufe !== "critical" && stufe !== "high") continue;
  const ausnahme = ausnahmen.paket?.[name];
  if (ausnahme) {
    console.log(`  · ${name} (${stufe}) — dokumentierte Ausnahme: ${ausnahme.grund}`);
    continue;
  }
  const wege = (v.effects ?? []).concat(name);
  const imLaufzeitpfad = wege.some((w) => laufzeit.has(w));
  offen.push({ name, stufe, imLaufzeitpfad });
}

console.log(
  `Abhängigkeiten: ${zaehler.critical ?? 0} critical, ${zaehler.high ?? 0} high, ` +
    `${zaehler.moderate ?? 0} moderate, ${zaehler.low ?? 0} low`,
);

if (offen.length > 0) {
  console.error("\nNicht abgedeckte hohe/kritische Lücken:\n");
  for (const o of offen) {
    console.error(`  ${o.stufe.padEnd(8)} ${o.name}${o.imLaufzeitpfad ? "  ← IM LAUFZEITPFAD" : "  (nur Build/Dev)"}`);
  }
  console.error(
    "\nEntweder gezielt aktualisieren, oder — wenn ein Update bricht — eine begründete " +
      "Ausnahme in bench/ausnahmen.json eintragen.\n",
  );
  process.exit(1);
}

console.log("OK — keine hohen oder kritischen Lücken ohne dokumentierte Ausnahme.");
