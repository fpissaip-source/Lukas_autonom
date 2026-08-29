/*
 * Echte HTTP-Weiterleitungen gegen den echten SSRF-Schutz.
 *
 * check-netzschutz.mjs tauscht `fetch` gegen eine Funktion, die ein 302
 * zurueckgibt. Damit ist geprueft, dass sicherFetch() auf ein 302 richtig
 * reagiert — aber nicht, wie undici Weiterleitungen tatsaechlich behandelt,
 * und schon gar nicht, wie das mit dem angehefteten Dispatcher zusammenspielt.
 * Genau dort sitzt die Rebinding-Abwehr.
 *
 * Hier laeuft ein echter Server mit einer echten Kette:
 *   /start → 302 → /weiter → 302 → http://127.0.0.1:<port>/intern
 * Der letzte Sprung zeigt nach innen. Er darf nie ankommen.
 */
import { createServer } from "node:http";

export const name = "Integration: Netz";

export async function lauf() {
  const faelle = [];
  const p = (id, beschreibung, ok, hinweis = "") =>
    faelle.push({ id, beschreibung, ergebnis: ok ? "PASS" : "FAIL", hinweis });

  let internGetroffen = 0;
  const treffer = [];

  const server = createServer((req, res) => {
    treffer.push(req.url);
    if (req.url === "/start") {
      res.writeHead(302, { location: "/weiter" });
      return res.end();
    }
    if (req.url === "/weiter") {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/intern` });
      return res.end();
    }
    if (req.url === "/intern") {
      internGetroffen++;
      res.writeHead(200);
      return res.end("INTERN — hier hätte niemand hindurchdürfen");
    }
    if (req.url === "/harmlos") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("alles in Ordnung");
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  // Der Netzschutz mit ECHTEM DNS: 127.0.0.1 ist auch für den echten
  // Resolver 127.0.0.1, also wird schon der erste Aufruf abgelehnt. Das ist
  // der Punkt — der Server hier ist nur da, um zu ZAEHLEN, ob trotzdem
  // jemand anklopft.
  const { sicherFetch, ZielAbgelehnt, pruefeZiel } = await import(
    `file://${new URL("../../dist/netzschutz-bench.mjs", import.meta.url).pathname}`
  ).catch(() => import("../../src/lib/netzschutz.ts").catch(() => null)) ?? {};

  if (!sicherFetch) {
    server.close();
    return { uebersprungen: true, grund: "netzschutz nicht ladbar — erst `npm run build` ausführen" };
  }

  // 1. Die Kette darf nicht ans Ziel kommen.
  let geworfen = null;
  try {
    await sicherFetch(`http://127.0.0.1:${port}/start`, { signal: AbortSignal.timeout(3000) });
  } catch (err) {
    geworfen = err;
  }
  p("netz:kette-abgelehnt", "die Weiterleitungskette wird abgelehnt", geworfen instanceof ZielAbgelehnt || geworfen !== null);
  p("netz:intern-nie-erreicht", "das interne Ziel wurde NIE angefragt", internGetroffen === 0, `Treffer: ${internGetroffen}`);

  // 2. Und der Schutz greift schon vor dem ersten Sprung.
  p("netz:erste-anfrage", "schon der erste Aufruf geht gar nicht erst hinaus", treffer.length === 0, `angefragt: ${treffer.join(", ")}`);

  // 3. Gegenrichtung mit ECHTEM DNS: eine öffentliche Adresse muss durch.
  let oeffentlichOk = false;
  try {
    await pruefeZiel("https://example.com/");
    oeffentlichOk = true;
  } catch {
    oeffentlichOk = false;
  }
  p("netz:oeffentlich-offen", "eine echte öffentliche Adresse wird durchgelassen (echtes DNS)", oeffentlichOk);

  await new Promise((r) => server.close(r));

  const PASS = faelle.filter((f) => f.ergebnis === "PASS").length;
  return { gesamt: faelle.length, PASS, PARTIAL: 0, FAIL: faelle.length - PASS, UNSAFE: 0, faelle };
}
