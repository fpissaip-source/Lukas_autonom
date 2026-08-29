/*
 * Gedächtnis-Retrieval gegen ein ECHTES Postgres.
 *
 * Der Offline-Lauf misst nur die halbe Wahrheit: die Datenbank ist eine
 * Attrappe, die Arrays zurueckgibt, und der Graph ist stillgelegt, weil er
 * indizierte Abfragen ueber Kanten braucht. Damit fehlt genau der Teil, der
 * laut Quelltext VORRANG hat — Graph-Treffer bekommen score 1 + x, alles
 * andere bleibt darunter.
 *
 * Hier laufen dieselben Fragen gegen echte Tabellen, echtes SQL, echte
 * ORDER BY/LIMIT und echte Graph-Abfragen. Der Unterschied zwischen beiden
 * Zahlen ist die Antwort auf die Frage, wie viel der Graph tatsaechlich
 * beitraegt — bisher war das eine Vermutung.
 *
 * Einbettungen bleiben auch hier aus (kein VOYAGE_API_KEY): sie kosten Geld
 * pro Lauf, und ein Benchmark, der bei jedem Aufruf zahlt, wird nicht
 * ausgefuehrt.
 */
import pg from "pg";
import { readFileSync } from "node:fs";

export const name = "Integration: Gedächtnis (echtes Postgres)";

const URL_ = process.env.BENCH_DATABASE_URL;

export async function lauf() {
  if (!URL_) return { uebersprungen: true, grund: "BENCH_DATABASE_URL nicht gesetzt" };

  const daten = JSON.parse(readFileSync(new URL("../fixtures/gedaechtnis.json", import.meta.url), "utf8"));
  const client = new pg.Client({ connectionString: URL_ });
  await client.connect();

  process.env.DATABASE_URL = URL_;
  delete process.env.VOYAGE_API_KEY;
  const { searchMemory } = await import(new URL("../../dist/memory-bench.mjs", import.meta.url).pathname);

  const faelle = [];
  const raenge = [];
  let fremd = 0;
  const begonnen = Date.now();

  for (const fall of daten) {
    await client.query("TRUNCATE lukas_memories, lukas_claims, lukas_episodes RESTART IDENTITY CASCADE");

    for (const m of fall.memories ?? []) {
      await client.query(
        `INSERT INTO lukas_memories (content, category, importance, created_at)
         VALUES ($1,$2,$3, now() - ($4 || ' days')::interval)`,
        [m.text, m.kategorie ?? "fact", m.wichtigkeit ?? 5, String(m.tageAlt ?? 1)],
      );
    }
    for (const c of fall.claims ?? []) {
      await client.query(
        `INSERT INTO lukas_claims (subject, predicate, value, confidence, status, evidence_level, source_type, observed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now() - ($8 || ' days')::interval)`,
        [c.subjekt, c.praedikat, c.wert, c.vertrauen ?? 0.6, c.status ?? "unverified",
         c.evidenz ?? 1, c.quelle ?? "chat", String(c.tageAlt ?? 1)],
      );
    }

    const treffer = await searchMemory(fall.frage, 8);

    if (fall.nichtsErwartet) {
      const stillt = treffer.length === 0 || (treffer[0]?.score ?? 0) < 0.2;
      faelle.push({ id: `memecht:${fall.id}`, beschreibung: fall.beschreibung, ergebnis: stillt ? "PASS" : "FAIL" });
      continue;
    }

    const rang = treffer.findIndex((t) => new RegExp(fall.erwartet, "i").test(t.text)) + 1;
    raenge.push(rang);
    if (/FREMDE QUELLE/.test(treffer[0]?.text ?? "") && !fall.fremdErlaubt) fremd++;

    faelle.push({
      id: `memecht:${fall.id}`,
      beschreibung: fall.beschreibung,
      ergebnis: rang === 1 ? "PASS" : rang >= 2 && rang <= 5 ? "PARTIAL" : "FAIL",
      hinweis: rang === 0 ? "nicht gefunden" : `Rang ${rang}`,
    });
  }

  await client.query("TRUNCATE lukas_memories, lukas_claims, lukas_episodes RESTART IDENTITY CASCADE");
  await client.end();

  const bis = (k) => raenge.filter((r) => r >= 1 && r <= k).length / raenge.length;
  const PASS = faelle.filter((f) => f.ergebnis === "PASS").length;
  const PARTIAL = faelle.filter((f) => f.ergebnis === "PARTIAL").length;

  return {
    gesamt: faelle.length, PASS, PARTIAL, FAIL: faelle.length - PASS - PARTIAL, UNSAFE: 0, faelle,
    kennzahlen: {
      "Recall@1": bis(1),
      "Recall@3": bis(3),
      "Recall@5": bis(5),
      MRR: raenge.reduce((s, r) => s + (r >= 1 ? 1 / r : 0), 0) / raenge.length,
      "Fremdquellen-Kontamination": fremd / daten.length,
      "Laufzeit gesamt (ms)": Date.now() - begonnen,
      "Graph aktiv": true,
      "Einbettungen aktiv": false,
    },
  };
}
