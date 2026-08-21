/*
 * Prueft, wie aus dem, was ein Telefonanbieter schickt, eine Nummer wird.
 *
 * Das ist die sicherheitskritische Stelle des ganzen Telefonwegs: an ihr
 * entscheidet sich, WELCHEN Lukas ein Anrufer bekommt. Greift sie daneben,
 * bekommt ein Fremder Issas privates Gedaechtnis ans Ohr — oder Issa selbst
 * wird nicht erkannt und redet mit dem oeffentlichen Lukas.
 *
 * Dieselbe Nummer kommt je nach Anbieter und Route in mindestens fuenf
 * Schreibweisen an. Alle muessen auf denselben Schluessel fallen.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".telefon-check-"));
const out = join(dir, "telefon.mjs");
const attrappe = join(dir, "attrappe.mjs");

writeFileSync(
  attrappe,
  `
export const db = new Proxy({}, { get: () => () => ({}) });
export const telefonNummern = {}; export const telefonAnrufe = {};
export const eq = () => ({}); export const desc = () => ({});
export const logger = { warn() {}, info() {}, error() {} };
export const buildSystemPrompt = async () => "privat";
export const buildPublicSystemPrompt = async () => "oeffentlich";
export const SPRACH_REGEL = ""; export const sprachAudio = () => ({});
export const sprachModell = () => "gpt-realtime-2.1";
`,
);

await build({
  entryPoints: ["src/lib/telefon.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    {
      name: "attrappen",
      setup(b) {
        b.onResolve({ filter: /^\.\// }, (args) =>
          args.importer.endsWith("telefon.ts") ? { path: attrappe } : undefined,
        );
      },
    },
  ],
});

const { normalisiere, nummerAusSip } = await import(out);

let fehler = 0;
const pruefe = (bedingung, text) => {
  if (!bedingung) {
    console.error("FEHLER — " + text);
    fehler++;
  }
};

const ERWARTET = "4915112345678";

// ── 1. Dieselbe Nummer, viele Schreibweisen ────────────────────────────────
for (const [roh, wie] of [
  ["+49 151 12345678", "international mit Leerzeichen"],
  ["+4915112345678", "international kompakt"],
  ["004915112345678", "mit Amtsnullen"],
  ["49-151-12345678", "mit Bindestrichen"],
  ["(+49) 151 / 123 456 78", "mit Klammern und Schraegstrich"],
]) {
  pruefe(normalisiere(roh) === ERWARTET, `${wie}: "${roh}" muss ${ERWARTET} ergeben, war ${normalisiere(roh)}`);
}

// ── 2. Aus dem SIP-From-Header ─────────────────────────────────────────────
for (const [header, wie] of [
  ['"Issa" <sip:+4915112345678@sip.twilio.com>', "mit Anzeigename und Plus"],
  ["<sip:4915112345678@sip.api.openai.com>", "spitze Klammern"],
  ["sip:4915112345678@host;transport=tls", "mit Transport-Parameter"],
  ['"Issa Hareb" <sip:004915112345678@host>;tag=abc123', "mit Tag hinten dran"],
]) {
  pruefe(
    nummerAusSip(header) === ERWARTET,
    `${wie}: ${header} muss ${ERWARTET} ergeben, war ${nummerAusSip(header)}`,
  );
}

// ── 3. Was NICHT durchgehen darf ───────────────────────────────────────────
// Eine fremde Nummer darf niemals auf Issas Schluessel fallen — sonst reicht
// ein aehnlich aussehender Header, um an den privaten Lukas zu kommen.
for (const fremd of [
  '"Issa" <sip:4915199999999@host>',
  "<sip:4930123456@host>",
  '"4915112345678" <sip:4930999999@host>',
]) {
  pruefe(
    nummerAusSip(fremd) !== ERWARTET,
    `Fremde Nummer darf nicht als Issa gelten: ${fremd} ergab ${nummerAusSip(fremd)}`,
  );
}

// Der Anzeigename wird zuletzt genannt, die echte Nummer steht in der URI —
// wer den Namen zuerst liest, laesst sich mit einem gefaelschten Namen
// hereinlegen.
pruefe(
  nummerAusSip('"4915112345678" <sip:4930999999@host>') === "4930999999",
  "Die Nummer muss aus der sip:-URI kommen, nicht aus dem frei waehlbaren Anzeigenamen",
);

// ── 4. Unbrauchbares faellt auf leer, nicht auf irgendwas ─────────────────
for (const murks of ["", "anonymous", "<sip:anonymous@anonymous.invalid>"]) {
  pruefe(
    normalisiere(nummerAusSip(murks)).length === 0,
    `Ohne Nummer muss leer herauskommen: "${murks}" ergab "${nummerAusSip(murks)}"`,
  );
}

rmSync(dir, { recursive: true, force: true });

if (fehler > 0) {
  console.error(`\n${fehler} Fehler in der Nummernerkennung.`);
  process.exit(1);
}
console.log("OK — Telefon: alle Schreibweisen treffen denselben Schlüssel, Fremdes bleibt fremd.");
