import OpenAI from "openai";

// Lazy-Initialisierung: Der Server soll auch OHNE konfigurierten OpenAI-Key
// booten können (Healthchecks, Widget-Statics, DB-Endpoints). Erst der erste
// echte API-Aufruf wirft, wenn der Key fehlt — die Routen fangen das ab.
let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;

  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_API_KEY ist nicht gesetzt — Lukas kann ohne OpenAI-Key nicht denken. " +
        "(Key von platform.openai.com eintragen.)",
    );
  }

  // .trim() + Anfuehrungszeichen/Schraegstrich am Rand entfernen: Provider-UIs
  // (Railway-Variablen-Editor) haengen beim Speichern manchmal Whitespace oder
  // ein Anfuehrungszeichen an -- das fuehrt sonst zu einer ungueltigen URL und
  // einer nackten 404 ohne erkennbare Ursache.
  const rawBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim();
  const baseURL = rawBaseUrl
    ? rawBaseUrl.replace(/^["']+/, "").replace(/["'\s/]+$/, "")
    : "https://api.openai.com/v1";

  _client = new OpenAI({ apiKey: apiKey.trim(), baseURL });
  return _client;
}

// Proxy mit identischer Export-Signatur: `openai.chat.completions.create(...)` etc.
// funktionieren unverändert; konstruiert wird erst beim ersten Zugriff.
export const openai: OpenAI = new Proxy({} as OpenAI, {
  get(_target, prop) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});
