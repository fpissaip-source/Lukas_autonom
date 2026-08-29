import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  /*
   * Versionierte Migrationen neben `push`.
   *
   * `push` gleicht das Schema an und ist beim Entwickeln bequem — aber es gibt
   * keinen Verlauf, kein Zurueck und keine Datei, die jemand vorher liest. Eine
   * versehentlich zerstoerende Aenderung faellt erst im Betrieb auf.
   *
   * `drizzle-kit generate` schreibt hierher SQL-Dateien mit fortlaufender
   * Nummer und einem Journal. `migrate` spielt sie in Reihenfolge ein und
   * merkt sich in __drizzle_migrations, was schon lief.
   */
  out: path.join(__dirname, "./migrations"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Sicherheitsnetz für geteilte Datenbanken (z.B. Railway-Postgres einer
  // Webseite): push fasst AUSSCHLIESSLICH diese Tabellen an und schlägt für
  // fremde Tabellen niemals Drops vor.
  tablesFilter: ["lukas_*", "trades", "bankroll_history"],
});
