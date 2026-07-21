import Anthropic from "@anthropic-ai/sdk";

// Lazy-Initialisierung: Der Server soll auch OHNE konfigurierten Anthropic-Key
// booten können (Healthchecks, Widget-Statics, DB-Endpoints). Erst der erste
// echte API-Aufruf wirft, wenn der Key fehlt — die Routen fangen das ab.
let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;

  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AI_INTEGRATIONS_ANTHROPIC_API_KEY ist nicht gesetzt — Lukas kann ohne Anthropic-Key nicht denken. " +
        "(Auf Replit: AI-Integration provisionieren; sonst Key von console.anthropic.com eintragen.)",
    );
  }

  _client = new Anthropic({
    apiKey,
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
  });
  return _client;
}

// Proxy mit identischer Export-Signatur: `anthropic.messages.stream(...)` etc.
// funktionieren unverändert; konstruiert wird erst beim ersten Zugriff.
export const anthropic: Anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});
