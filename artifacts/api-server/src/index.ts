import app from "./app";
import { startMoltbookWorker } from "./lib/moltbook-worker";
import { startConsolidationWorker } from "./lib/consolidation-worker";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Konfigurations-Diagnose (nur gesetzt/fehlt — niemals Werte loggen)
  const envStatus = Object.fromEntries(
    [
      "DATABASE_URL",
      "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
      "LUKAS_API_TOKEN",
      "ELEVENLABS_API_KEY",
      "ELEVENLABS_LLM_TOKEN",
      "ELEVENLABS_AGENT_ID",
      "MOLTBOOK_API_KEY",
      "VOYAGE_API_KEY",
      "VPS_DATABASE_URL",
    ].map((k) => [k, process.env[k] ? "gesetzt" : "FEHLT"]),
  );
  logger.info(envStatus, "Env-Status");
  if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    logger.warn(
      "AI_INTEGRATIONS_ANTHROPIC_API_KEY fehlt — Server läuft, aber Lukas kann nicht denken (Chat/Reflexion/Moltbook liefern Fehler), bis der Key gesetzt ist.",
    );
  }
  if (!process.env.LUKAS_API_TOKEN) {
    logger.warn("LUKAS_API_TOKEN fehlt — die private API ist UNGESCHÜTZT. Vor echtem Betrieb setzen!");
  }

  startMoltbookWorker();
  startConsolidationWorker();
});
