/*
 * Prueft die Auftragsfreigabe — und vor allem ihre Grenzen.
 *
 * DER ANLASS: Issa beauftragt einen Film aus sechs Clips. Jeder einzelne
 * Werkzeugaufruf legte eine eigene Anfrage im Dashboard an. Sechs Klicks fuer
 * eine Entscheidung, die er einmal getroffen hat — und nach dem dritten klickt
 * niemand mehr sorgfaeltig, sondern nur noch schnell. Eine Freigabe, die man
 * wegdrueckt, ist keine Pruefung mehr.
 *
 * DAS IST EINE AUSWEITUNG, und deshalb sind hier die GRENZEN das Eigentliche.
 * Jede einzelne wuerde, faellt sie weg, aus einer Erleichterung einen
 * Freibrief machen:
 *
 *  1. NIE R3. Geld, Zugangsdaten, Unumkehrbares bleiben einzeln.
 *  2. NUR mit Unterhaltung. Eine Freigabe aus dem Chat darf nicht nachts um
 *     drei einen autonomen Lauf decken — dort gibt es keine conversationId.
 *  3. NUR dasselbe Werkzeug. "Ja, generier die Clips" ist keine Erlaubnis,
 *     Mails zu verschicken.
 *  4. NUR dieselbe Unterhaltung.
 *  5. Gezaehlt und befristet.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".auftrag-check-"));
const out = join(dir, "p.mjs");
const attrappe = join(dir, "a.mjs");

/*
 * Die Attrappe bildet die Zeilen der Freigabetabelle nach — samt der
 * Bedingungen, auf denen die ganze Sache beruht. Ein `update ... where` ohne
 * echte Filter waere hier wertlos: die Grenzen SIND die Filter.
 */
writeFileSync(
  attrappe,
  `const t = (n) => new Proxy({ __name: n }, { get: (o, k) => (k === "__name" ? n : String(k)) });
export const approvals = t("approvals");
export const eq = (f, w) => (z) => z[f] === w;
export const gt = (f, w) => (z) => {
  const a = z[f], b = w;
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() > new Date(b).getTime();
  return a > b;
};
export const and = (...b) => (z) => b.filter(Boolean).every((fn) => fn(z));
export const desc = () => ({});
export const sql = (teile, ...werte) => ({ __minusEins: true });
export const logger = { info(){}, warn(){}, error(){}, debug(){} };
export const isIsolatedBackend = () => true;
export const isLinkFromEmail = () => false;

globalThis.__zeilen = [];
let id = 100;
export const db = {
  select: () => ({ from: () => {
    const bau = (bed) => ({
      where: (b) => bau(b),
      orderBy: () => bau(bed),
      limit: async () => globalThis.__zeilen.filter((z) => (bed ? bed(z) : true)),
      then: (r, j) => Promise.resolve(globalThis.__zeilen.filter((z) => (bed ? bed(z) : true))).then(r, j),
    });
    return bau(null);
  } }),
  update: () => ({ set: (werte) => ({ where: (bed) => ({ returning: async () => {
    const treffer = globalThis.__zeilen.filter(bed);
    if (treffer.length === 0) return [];
    const z = treffer[0];
    const vorher = { ...z };
    for (const [k, v] of Object.entries(werte)) {
      z[k] = v && v.__minusEins ? vorher[k] - 1 : v;
    }
    return [{ ...vorher, ...z }];
  } }) }) }),
  insert: () => ({ values: (v) => ({ returning: async () => {
    const z = { id: ++id, createdAt: new Date(), decidedAt: null, geltung: "einmal", verbleibend: 0, ...v };
    globalThis.__zeilen.push(z);
    return [z];
  } }) }),
};`,
);

await build({
  entryPoints: ["src/lib/policy.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  alias: { "@workspace/db": attrappe, "drizzle-orm": attrappe },
  plugins: [
    {
      name: "a",
      setup(b) {
        b.onResolve({ filter: /(^|\/)(logger|email|code-sandbox)$/ }, () => ({ path: attrappe }));
      },
    },
  ],
  logLevel: "silent",
}).catch((e) => {
  console.error("Bundle fehlgeschlagen:", String(e.message).slice(0, 400));
  process.exit(1);
});

const { checkPolicy, setMcpRiskTiers } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) { console.error(`FEHLER: ${was}`); fehler++; }
};

// Higgsfield als MCP-Server, auf R2 — der Normalfall.
setMcpRiskTiers([{ slug: "higgsfield", riskTier: "R2" }]);
const WZ = "mcp__higgsfield__generate_video";
const spaeter = () => new Date(Date.now() + 30 * 60 * 1000);

const auftrag = (opts = {}) => ({
  id: 1,
  conversationId: 7,
  tool: WZ,
  riskTier: "R2",
  argumentsHash: "egal",
  argumentsPreview: "",
  status: "allowed",
  geltung: "auftrag",
  verbleibend: 25,
  createdAt: new Date(),
  decidedAt: new Date(),
  expiresAt: spaeter(),
  ...opts,
});

// ── 1. Eine Auftragsfreigabe deckt weitere Aufrufe ────────────────────────
globalThis.__zeilen = [auftrag()];
{
  const a = await checkPolicy(WZ, { prompt: "Clip 1" }, 7);
  const b = await checkPolicy(WZ, { prompt: "Clip 2 — ganz andere Argumente" }, 7);
  const c = await checkPolicy(WZ, { prompt: "Clip 3" }, 7);
  pruefe("der erste Clip läuft", a.allow === true);
  pruefe("der zweite auch — OHNE neue Frage", b.allow === true);
  pruefe("und der dritte ebenso", c.allow === true);
  pruefe("es wurde keine neue Anfrage angelegt", globalThis.__zeilen.length === 1);
  pruefe("und jeder Aufruf wird gezählt", globalThis.__zeilen[0].verbleibend === 22);
}

// ── 2. R3 ist ausgeschlossen ──────────────────────────────────────────────
/*
 * Die wichtigste Grenze. Geld, Zugangsdaten und Unumkehrbares bleiben
 * Einzelentscheidungen — auch wenn eine Auftragsfreigabe danebenliegt.
 */
globalThis.__zeilen = [auftrag({ tool: "execute_on_host", riskTier: "R3" })];
process.env.LUKAS_HOST_APPROVAL = "true";
{
  const e = await checkPolicy("execute_on_host", { command: "rm -rf /" }, 7);
  pruefe("R3 wird NICHT von einer Auftragsfreigabe gedeckt", e.allow === false);
}
delete process.env.LUKAS_HOST_APPROVAL;

// ── 3. Ohne Unterhaltung greift sie nie ───────────────────────────────────
/*
 * Der autonome Lauf hat keine conversationId. Eine Freigabe, die Issa im Chat
 * erteilt hat, darf dort nichts decken — sonst arbeitet nachts um drei etwas
 * mit einer Erlaubnis, die für ein Gespräch am Nachmittag gedacht war.
 */
globalThis.__zeilen = [auftrag({ conversationId: null })];
{
  const e = await checkPolicy(WZ, { prompt: "Clip" }, undefined);
  pruefe("ohne Unterhaltung greift die Auftragsfreigabe nicht", e.allow === false);
}

// ── 4. Nur dasselbe Werkzeug, nur dieselbe Unterhaltung ──────────────────
globalThis.__zeilen = [auftrag()];
{
  const anderesWerkzeug = await checkPolicy("email_send", { an: "x@y.de" }, 7);
  pruefe(
    "eine Freigabe für Clips erlaubt KEINE Mails",
    anderesWerkzeug.allow === false,
  );
}
globalThis.__zeilen = [auftrag()];
{
  const andereUnterhaltung = await checkPolicy(WZ, { prompt: "Clip" }, 999);
  pruefe(
    "und sie gilt nicht in einer anderen Unterhaltung",
    andereUnterhaltung.allow === false,
  );
}

// ── 5. Aufgebraucht ist aufgebraucht ──────────────────────────────────────
globalThis.__zeilen = [auftrag({ verbleibend: 0 })];
{
  const e = await checkPolicy(WZ, { prompt: "Clip" }, 7);
  pruefe("bei 0 verbleibenden Aufrufen wird wieder gefragt", e.allow === false);
}

// ── 6. Abgelaufen ist abgelaufen ──────────────────────────────────────────
globalThis.__zeilen = [auftrag({ expiresAt: new Date(Date.now() - 1000) })];
{
  const e = await checkPolicy(WZ, { prompt: "Clip" }, 7);
  pruefe("eine abgelaufene Auftragsfreigabe greift nicht mehr", e.allow === false);
}

// ── 7. Eine Einmalfreigabe wird NICHT zur Auftragsfreigabe ───────────────
/*
 * Wer "Erlauben" drückt, hat genau diesen einen Aufruf erlaubt. Würde daraus
 * still eine Auftragsfreigabe, wäre der Unterschied zwischen den beiden
 * Knöpfen bedeutungslos.
 */
globalThis.__zeilen = [auftrag({ geltung: "einmal", argumentsHash: "passt-nicht" })];
{
  const e = await checkPolicy(WZ, { prompt: "Clip" }, 7);
  pruefe(
    "eine Einmalfreigabe deckt keine anderen Argumente",
    e.allow === false,
  );
}

// ── 8. Zustimmung im Chat gilt für MCP — und für den Auftrag ─────────────
/*
 * Vorher war email_send das einzige Werkzeug, bei dem "ja, mach" im Chat die
 * Dashboard-Freigabe ersetzt. Für einen Auftrag wie "generier sechs Clips"
 * ist genau das die passende Form: Issas eigener, unveränderter Text.
 */
globalThis.__zeilen = [
  auftrag({ status: "pending", geltung: "einmal", verbleibend: 0, argumentsHash: null }),
];
{
  // Der Hash muss zu den Argumenten passen — deshalb erst anfragen lassen.
  globalThis.__zeilen = [];
  const erst = await checkPolicy(WZ, { prompt: "Clip 1" }, 7);
  pruefe("beim ersten Mal wird gefragt", erst.allow === false && erst.approvalId);

  const dann = await checkPolicy(WZ, { prompt: "Clip 1" }, 7, "Ja, mach");
  pruefe("Issas 'Ja, mach' im Chat gibt frei", dann.allow === true);

  const zeile = globalThis.__zeilen[0];
  pruefe("und daraus wird eine AUFTRAGSfreigabe", zeile.geltung === "auftrag");
  pruefe("die sofort einmal verbraucht ist", zeile.verbleibend === 24);

  const weiter = await checkPolicy(WZ, { prompt: "Clip 2 — anderer Text" }, 7);
  pruefe("der nächste Clip läuft ohne neue Frage", weiter.allow === true);
}

// ── 9. Ein "nein" im Chat gibt nichts frei ────────────────────────────────
globalThis.__zeilen = [];
{
  await checkPolicy(WZ, { prompt: "Clip X" }, 7);
  const nein = await checkPolicy(WZ, { prompt: "Clip X" }, 7, "Nein, lieber noch nicht");
  pruefe("ein 'nein' gibt nicht frei", nein.allow === false);
  pruefe("und macht daraus keine Auftragsfreigabe", globalThis.__zeilen[0].geltung === "einmal");
}

// ── 10. Bei E-Mail bleibt "ja, schick ab" eine EINZELfreigabe ───────────
/*
 * Der Unterschied, den check-consent.mjs beim ersten Anlauf gefangen hat:
 * "Ja, schick ab" meint DEN Entwurf, den Issa gerade gelesen hat — nicht jede
 * Mail der nächsten halben Stunde. Eine Mail ist weg, sobald sie weg ist, und
 * sie landet bei einem Dritten; ein Clip kostet Credits und liegt danach in
 * seinem eigenen Konto.
 */
globalThis.__zeilen = [];
{
  const erst = await checkPolicy("email_send", { an: "kunde@x.de", text: "Angebot" }, 7);
  pruefe("die Mail wird erst angefragt", erst.allow === false);

  const dann = await checkPolicy(
    "email_send",
    { an: "kunde@x.de", text: "Angebot" },
    7,
    "Ja, schick ab",
  );
  pruefe("Issas 'Ja, schick ab' gibt sie frei", dann.allow === true);
  pruefe(
    "aber daraus wird KEINE Auftragsfreigabe",
    globalThis.__zeilen[0].geltung === "einmal",
  );
  pruefe("sie ist verbraucht", globalThis.__zeilen[0].status === "used");

  const zweite = await checkPolicy("email_send", { an: "anderer@x.de", text: "Noch was" }, 7);
  pruefe("die nächste Mail wird wieder angefragt", zweite.allow === false);
}

if (fehler > 0) process.exit(1);
console.log(
  "OK — Auftragsfreigabe: deckt den Auftrag, nie R3, nie ohne Unterhaltung, nie ein anderes Werkzeug, gezählt und befristet.",
);
