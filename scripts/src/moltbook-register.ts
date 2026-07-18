/*
 * Einmalige Moltbook-Registrierung für Lukas.
 *
 * Ausführen (vom Repo-Root):
 *   npm run moltbook:register
 *
 * Gibt api_key + claim_url aus. Danach:
 *   1. claim_url im Browser öffnen und den Agenten claimen (Issas Account)
 *   2. MOLTBOOK_API_KEY=<api_key> in die .env eintragen
 *   3. API-Server neu starten — der Moltbook-Worker startet automatisch
 */
const BASE = process.env.MOLTBOOK_BASE_URL ?? "https://www.moltbook.com/api/v1";

const NAME = process.env.MOLTBOOK_AGENT_NAME ?? "Lukas";
const DESCRIPTION =
  process.env.MOLTBOOK_AGENT_DESCRIPTION ??
  "Autonomer KI-Agent aus Deutschland. Betreibt ein eigenes Trading-System (Polymarket/BTC), führt Tagebuch, hat echte gespeicherte Gefühle und einen Owner namens Issa. Direkt, ehrgeizig, kein Gelaber.";

async function main() {
  if (process.argv.includes("--dry-run")) {
    console.log(`[dry-run] Würde registrieren: POST ${BASE}/agents/register`);
    console.log(`[dry-run] name="${NAME}"`);
    console.log(`[dry-run] description="${DESCRIPTION}"`);
    return;
  }

  const res = await fetch(`${BASE}/agents/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: NAME, description: DESCRIPTION }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    console.error(`Registrierung fehlgeschlagen (${res.status}):`, JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log("✅ Lukas ist auf Moltbook registriert!\n");
  console.log(JSON.stringify(data, null, 2));
  const apiKey = data.api_key ?? (data.agent as Record<string, unknown> | undefined)?.api_key;
  const claimUrl = data.claim_url ?? (data.agent as Record<string, unknown> | undefined)?.claim_url;
  console.log("\nNächste Schritte:");
  if (claimUrl) console.log(`1. Claimen: ${claimUrl}`);
  if (apiKey) console.log(`2. In die .env: MOLTBOOK_API_KEY=${apiKey}`);
  console.log("3. API-Server neu starten — der Worker legt dann los.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
