/*
 * Prueft, dass ein Netzfehler seine Ursache mitbringt.
 *
 * ANLASS: Lukas schrieb selbst, er koenne nicht sagen, "ob DNS, TLS, Proxy,
 * Egress oder Control Plane betroffen ist" — ihm lag nur `fetch failed` vor.
 * Das Aergerliche: die Information WAR da. Node wirft bei einem gescheiterten
 * fetch ein `TypeError: fetch failed` und haengt den echten Fehler als `cause`
 * daran. Der Code las nur `err.message` und warf die Ursache weg.
 *
 * Die Unterscheidung, um die es geht, ist nicht akademisch. Sie beantwortet
 * genau eine Frage: LOHNT EIN ZWEITER VERSUCH? Bei einem Zeitlimit
 * vielleicht, bei einem unbekannten Namen nie. Ein Agent, der das nicht
 * unterscheiden kann, versucht es bis zum Rundenlimit.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = mkdtempSync(join(process.cwd(), ".fehler-check-"));
const out = join(dir, "f.mjs");

await build({
  entryPoints: ["src/lib/fehlertext.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  logLevel: "silent",
});

const { fehlerText, netzDiagnose } = await import(`file://${out}`);
rmSync(dir, { recursive: true, force: true });

let fehler = 0;
const pruefe = (was, bedingung) => {
  if (!bedingung) { console.error(`FEHLER: ${was}`); fehler++; }
};

/** So sieht ein gescheiterter fetch in Node wirklich aus. */
const wieNode = (ursacheText, code) => {
  const ursache = Object.assign(new Error(ursacheText), code ? { code } : {});
  return Object.assign(new TypeError("fetch failed"), { cause: ursache });
};

// ── 1. Die Ursache kommt mit ──────────────────────────────────────────────
{
  const err = wieNode("getaddrinfo ENOTFOUND api.github.com", "ENOTFOUND");
  const text = fehlerText(err);
  pruefe("die äußere Meldung bleibt", text.includes("fetch failed"));
  pruefe("und die ECHTE Ursache steht dabei", text.includes("ENOTFOUND"));
  pruefe("samt Host", text.includes("api.github.com"));
  pruefe(
    "sie ist NICHT mehr nur 'fetch failed'",
    text !== "fetch failed" && text.length > "fetch failed".length,
  );
}

// ── 2. Auch mehrere Ebenen tief ───────────────────────────────────────────
/*
 * undici verpackt gern mehrfach: fetch failed → ConnectTimeoutError →
 * ETIMEDOUT. Erst die letzte Ebene ist die brauchbare.
 */
{
  const innen = Object.assign(new Error("connect ETIMEDOUT 1.2.3.4:443"), { code: "ETIMEDOUT" });
  const mitte = Object.assign(new Error("Connect Timeout Error"), {
    cause: innen,
    code: "UND_ERR_CONNECT_TIMEOUT",
  });
  const aussen = Object.assign(new TypeError("fetch failed"), { cause: mitte });
  const text = fehlerText(aussen);
  pruefe("alle drei Ebenen kommen an", /fetch failed/.test(text) && /ETIMEDOUT/.test(text));
  pruefe("in der richtigen Reihenfolge, außen nach innen", text.indexOf("fetch failed") === 0);
}

// ── 3. Doppeltes wird nicht doppelt genannt ───────────────────────────────
{
  const innen = new Error("fetch failed");
  const aussen = Object.assign(new TypeError("fetch failed"), { cause: innen });
  pruefe("'fetch failed: fetch failed' entsteht nicht", fehlerText(aussen) === "fetch failed");
}

// ── 4. Jede Ursache sagt, ob ein zweiter Versuch lohnt ────────────────────
const faelle = [
  ["getaddrinfo ENOTFOUND api.github.com", "ENOTFOUND", /DNS/, false],
  ["connect ECONNREFUSED 10.0.0.1:443", "ECONNREFUSED", /lehnt die Verbindung ab/, false],
  ["unable to verify the first certificate", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", /TLS/, false],
  ["connect ETIMEDOUT", "ETIMEDOUT", /Zeitüberschreitung/, true],
  ["socket hang up", "ECONNRESET", /abgebrochen/, true],
  ["connect EHOSTUNREACH", "EHOSTUNREACH", /Kein Netzweg/, false],
];

for (const [msg, code, muster, lohntNochmal] of faelle) {
  const text = netzDiagnose(wieNode(msg, code), "api.github.com");
  pruefe(`"${msg.slice(0, 28)}…" wird eingeordnet`, muster.test(text));
  pruefe(`… und nennt das Ziel`, text.includes("api.github.com"));
  pruefe(
    `… und sagt, ob ein zweiter Versuch lohnt (${lohntNochmal ? "ja" : "nein"})`,
    lohntNochmal
      ? /zweiter Versuch kann klappen/.test(text)
      : /zweiter Versuch bringt nichts/.test(text),
  );
}

// ── 5. Verschiedene Ursachen ergeben verschiedene Texte ───────────────────
/*
 * Sonst faellt in der Selbstheilung alles zu EINER Fehlergruppe zusammen —
 * dreissig Fehler, die nichts miteinander zu tun haben, in einem Topf.
 */
{
  const texte = new Set(faelle.map(([m, c]) => netzDiagnose(wieNode(m, c))));
  pruefe("sechs Ursachen ergeben sechs verschiedene Diagnosen", texte.size === faelle.length);
}

// ── 6. 'fetch failed' ohne Ursache wird als solches benannt ───────────────
/*
 * Der seltene Fall, dass Node wirklich nichts mitgibt. Dann soll dastehen,
 * dass NICHTS bekannt ist — sonst sucht Lukas eine Bedeutung, die der Text
 * nicht hat, und rät sie sich zusammen. Genau das ist im Chat passiert.
 */
{
  const text = netzDiagnose(new TypeError("fetch failed"));
  pruefe("es steht dabei, dass keine Ursache mitkam", /ohne Ursache|keinen Grund/.test(text));
  pruefe("und dass er nicht raten soll", /rate nicht/.test(text));
}

// ── 7. Nicht-Netzfehler bleiben unverfälscht ──────────────────────────────
{
  const text = netzDiagnose(new Error("GitHub API 401: Bad credentials"));
  pruefe("ein Anwendungsfehler wird nicht umgedeutet", text.includes("401"));
  pruefe("und bekommt keine erfundene Netzursache", !/DNS|TLS|Proxy/.test(text));
}

// ── 8. Und es ist verdrahtet ──────────────────────────────────────────────
/*
 * Am Quelltext, und das steht hier ausdruecklich so: die Alternative waere,
 * einen ganzen Werkzeuglauf nachzubauen, nur um zu sehen, welche Funktion
 * die Meldung erzeugt.
 */
{
  const fs = await import("node:fs");
  const brain = fs.readFileSync("src/lib/lukas-brain.ts", "utf8");
  pruefe(
    "der Werkzeugfehler geht durch netzDiagnose",
    /content: `Fehler: \$\{netzDiagnose\(err\)\}`/.test(brain),
  );
  pruefe(
    "und die rohe Meldung wird dort nicht mehr benutzt",
    !/content: `Fehler: \$\{err instanceof Error \? err\.message/.test(brain),
  );
  const dbg = fs.readFileSync("src/lib/debug-log.ts", "utf8");
  pruefe(
    "das Fehlerprotokoll speichert die Ursachenkette",
    /const message = fehlerText\(err\)/.test(dbg),
  );
}

if (fehler > 0) process.exit(1);
console.log(
  "OK — Fehlertexte: die Ursache aus err.cause kommt mit, jede Art wird unterschieden, und es steht dabei, ob ein zweiter Versuch lohnt.",
);
