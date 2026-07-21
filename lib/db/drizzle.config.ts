import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Sicherheitsnetz für geteilte Datenbanken (z.B. Railway-Postgres einer
  // Webseite): push fasst AUSSCHLIESSLICH diese Tabellen an und schlägt für
  // fremde Tabellen niemals Drops vor.
  tablesFilter: ["lukas_*", "trades", "bankroll_history"],
});
