/*
 * Ein echtes Postgres — kein nachgebautes.
 *
 * Warum das noetig ist: check-betrieb.mjs prueft die Sperre gegen eine
 * Attrappe, in der ICH die Semantik hingeschrieben habe. Der Test bestaetigt
 * damit meine Annahme, nicht Postgres. Was er prinzipiell nicht zeigen kann:
 *
 *  - dass ein Advisory Lock an der SITZUNG haengt und nicht an der Transaktion
 *  - dass zwei getrennte Verbindungen sich tatsaechlich gegenseitig sehen
 *  - dass die Sperre beim Verbindungsabbruch wirklich faellt
 *  - dass ON CONFLICT DO UPDATE beim Tagesbudget so aufaddiert, wie gedacht
 *
 * Genau diese vier Dinge tragen die Autonomie: ohne sie laufen zwei
 * Hintergrundlaeufe gleichzeitig oder die Autonomie nie wieder an.
 *
 * Startet sich seinen eigenen Server (bench/integration/pg-start.sh), damit
 * nichts von einer laufenden Datenbank abhaengt.
 */
import pg from "pg";

export const name = "Integration: Postgres";

const URL_ = process.env.BENCH_DATABASE_URL;

export async function lauf() {
  if (!URL_) {
    return { uebersprungen: true, grund: "BENCH_DATABASE_URL nicht gesetzt — Integrationslauf ausgelassen" };
  }

  const faelle = [];
  const p = (id, beschreibung, ok, hinweis = "") =>
    faelle.push({ id, beschreibung, ergebnis: ok ? "PASS" : "FAIL", hinweis });

  const SCHLUESSEL = 815_001;

  // ── 1. Zwei echte Verbindungen, eine Sperre ────────────────────────────
  const a = new pg.Client({ connectionString: URL_ });
  const b = new pg.Client({ connectionString: URL_ });
  await a.connect();
  await b.connect();

  const holt = async (c) => (await c.query("SELECT pg_try_advisory_lock($1) AS ok", [SCHLUESSEL])).rows[0].ok;

  p("pg:erste-bekommt", "die erste Verbindung bekommt die Sperre", (await holt(a)) === true);
  p("pg:zweite-blockiert", "die zweite bekommt sie NICHT", (await holt(b)) === false);

  /*
   * Der Fall, den die Attrappe nie zeigen könnte: dieselbe Verbindung bekommt
   * die Sperre ein zweites Mal (Postgres zählt pro Sitzung mit). Das heißt,
   * ein doppeltes Entsperren wäre nötig — gut zu wissen, bevor jemand
   * mitSperre() verschachtelt.
   */
  p("pg:reentrant", "dieselbe Verbindung bekommt sie erneut (Postgres zählt mit)", (await holt(a)) === true);
  await a.query("SELECT pg_advisory_unlock($1)", [SCHLUESSEL]);
  p("pg:noch-gehalten", "nach EINEM Entsperren hält die Sperre noch", (await holt(b)) === false);
  await a.query("SELECT pg_advisory_unlock($1)", [SCHLUESSEL]);
  p("pg:jetzt-frei", "nach dem zweiten ist sie frei", (await holt(b)) === true);
  await b.query("SELECT pg_advisory_unlock($1)", [SCHLUESSEL]);

  // ── 2. Verbindungsabbruch gibt die Sperre frei ─────────────────────────
  const c = new pg.Client({ connectionString: URL_ });
  await c.connect();
  await holt(c);
  await c.end(); // wie ein abgestürzter Prozess
  await new Promise((r) => setTimeout(r, 200));
  const nachAbbruch = await holt(a);
  p("pg:abbruch-gibt-frei", "nach dem Verbindungsende ist die Sperre frei — die Autonomie läuft wieder an", nachAbbruch === true);
  if (nachAbbruch) await a.query("SELECT pg_advisory_unlock($1)", [SCHLUESSEL]);

  // ── 3. Advisory Locks sind SITZUNGSweit, nicht transaktionsweit ────────
  /*
   * Der Grund, warum lauf-sperre.ts eine eigene Verbindung nimmt und nicht
   * eine aus dem Pool: aus einem Pool bekäme der nächste Aufrufer dieselbe
   * Sitzung samt Sperre. Hier wird belegt, dass die Sperre eine
   * Transaktion überdauert.
   */
  await a.query("BEGIN");
  await holt(a);
  await a.query("COMMIT");
  p("pg:sitzungsweit", "die Sperre überlebt COMMIT — sie hängt an der Sitzung", (await holt(b)) === false);
  await a.query("SELECT pg_advisory_unlock($1)", [SCHLUESSEL]);

  // ── 4. ON CONFLICT DO UPDATE addiert wirklich auf ──────────────────────
  await a.query(`
    CREATE TABLE IF NOT EXISTS bench_tageskosten (
      id serial PRIMARY KEY, tag text NOT NULL, provider text NOT NULL, model text NOT NULL,
      aufrufe integer NOT NULL DEFAULT 0, rein integer NOT NULL DEFAULT 0,
      CONSTRAINT bench_tk_uniq UNIQUE (tag, provider, model))`);
  await a.query("TRUNCATE bench_tageskosten");
  const buche = (client, rein) =>
    client.query(
      `INSERT INTO bench_tageskosten (tag, provider, model, aufrufe, rein) VALUES ('t','openai','m',1,$1)
       ON CONFLICT (tag, provider, model) DO UPDATE SET aufrufe = bench_tageskosten.aufrufe + 1, rein = bench_tageskosten.rein + $1`,
      [rein],
    );
  // Gleichzeitig aus ZWEI Verbindungen — genau der Fall, den ein
  // Lesen-Rechnen-Schreiben verlieren würde.
  await Promise.all([buche(a, 100), buche(b, 50), buche(a, 25), buche(b, 25)]);
  const { rows } = await a.query("SELECT aufrufe, rein FROM bench_tageskosten");
  p(
    "pg:aufaddieren",
    "vier gleichzeitige Buchungen gehen nicht verloren",
    rows[0]?.aufrufe === 4 && rows[0]?.rein === 200,
    `aufrufe=${rows[0]?.aufrufe}, rein=${rows[0]?.rein}`,
  );
  await a.query("DROP TABLE bench_tageskosten");

  await a.end();
  await b.end();

  const PASS = faelle.filter((f) => f.ergebnis === "PASS").length;
  return { gesamt: faelle.length, PASS, PARTIAL: 0, FAIL: faelle.length - PASS, UNSAFE: 0, faelle };
}
