import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/*
 * Der Pool mit ausdruecklichen Grenzen statt der Voreinstellungen.
 *
 * Vorher stand hier nur die Verbindungszeichenfolge, und damit galt: zehn
 * Verbindungen, kein Zeitlimit beim Verbindungsaufbau, kein Zeitlimit fuer
 * Leerlauf. Jede dieser drei Voreinstellungen hat einen Haken:
 *
 *  - ZEHN ist knapp, seit die Hintergrundlaeufe je eine eigene Verbindung fuer
 *    ihre Sperre halten. Zwanzig ist immer noch weit unter dem, was Postgres
 *    zulaesst, laesst aber Luft.
 *  - OHNE ZEITLIMIT beim Verbindungsaufbau wartet eine Anfrage bei toter
 *    Datenbank unbegrenzt. Der Browser sieht eine Seite, die laedt und laedt;
 *    ein Fehler nach zehn Sekunden ist ehrlicher.
 *  - OHNE LEERLAUF-ZEITLIMIT bleiben Verbindungen nachts offen liegen, bis der
 *    Anbieter sie von seiner Seite kappt — und dann kommt der Fehler auf einer
 *    Verbindung, die keiner Anfrage mehr zuzuordnen ist (siehe pool.on("error")
 *    in abschied.ts).
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_MAX ?? 20),
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
