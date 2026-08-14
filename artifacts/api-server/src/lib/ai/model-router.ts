import { logger } from "../logger";

export type LukasProvider = "openai" | "anthropic" | "google";
export type ModelProfile = "fast" | "general" | "reasoning" | "code" | "vision" | "long_context";

export type ModelRoute = {
  provider: LukasProvider;
  model: string;
  profile: ModelProfile;
  reason: string;
};

export type RouteInput = {
  userText: string;
  hasAttachments?: boolean;
  attachmentKinds?: string[];
  usedTools?: string[];
  iteration?: number;
};

function nonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

function parseModelSpec(spec: string, profile: ModelProfile, reason: string): ModelRoute {
  const value = spec.trim();
  const colon = value.indexOf(":");
  if (colon > 0) {
    const provider = value.slice(0, colon).trim().toLowerCase();
    const model = value.slice(colon + 1).trim();
    if ((provider === "openai" || provider === "anthropic" || provider === "google") && model) {
      return { provider, model, profile, reason };
    }
  }
  return { provider: "openai", model: value, profile, reason };
}

/*
 * Standardbesetzung der Rollen.
 *
 * Die 5.6-Familie (sol/terra/luna) loest die alte base/mini/nano-Benennung ab.
 * Lukas waehlt pro Nachricht selbst, welche Rolle passt — kurze Rueckfrage
 * bekommt luna, ein normales Gespraech terra, Denkarbeit und Code sol.
 *
 * Warum das jetzt gefahrlos ist: schlaegt ein Modell fehl, weil der Account es
 * nicht freigeschaltet hat, faellt model-client.ts einmal auf LUKAS_CORE_MODEL
 * zurueck und merkt sich die ID fuer eine Stunde. Ohne dieses Netz hat exakt
 * diese Umstellung schon einmal den oeffentlichen Chat lahmgelegt. Eine
 * Modell-ID, die der Account nicht hat, kostet damit Qualitaet, nicht die
 * Funktion.
 *
 * Jede Rolle bleibt per Umgebungsvariable ueberschreibbar.
 */
const DEFAULTS: Record<ModelProfile, string> = {
  fast: "openai:gpt-5.6-luna",
  general: "openai:gpt-5.6-terra",
  reasoning: "openai:gpt-5.6-sol",
  code: "openai:gpt-5.6-sol",
  vision: "openai:gpt-5.6-terra",
  long_context: "openai:gpt-5.6-sol",
};

function configured(profile: ModelProfile, reason: string): ModelRoute {
  // Ist LUKAS_CORE_MODEL ausdruecklich gesetzt, gewinnt es ueber die
  // Standardbesetzung — sonst koennte man nicht mehr gezielt zurueckstellen.
  const core = nonEmpty(process.env.LUKAS_CORE_MODEL);
  const general = nonEmpty(process.env.LUKAS_MODEL_GENERAL) ?? (core ? `openai:${core}` : DEFAULTS.general);
  const reasoning = nonEmpty(process.env.LUKAS_MODEL_REASONING) ?? (core ? general : DEFAULTS.reasoning);
  const fastFallback = nonEmpty(process.env.LUKAS_FAST_MODEL, process.env.LUKAS_PUBLIC_MODEL);

  const specs: Record<ModelProfile, string> = {
    fast:
      nonEmpty(process.env.LUKAS_MODEL_FAST) ??
      (fastFallback ? `openai:${fastFallback}` : DEFAULTS.fast),
    general,
    reasoning,
    code: nonEmpty(process.env.LUKAS_MODEL_CODE) ?? (core ? reasoning : DEFAULTS.code),
    vision: nonEmpty(process.env.LUKAS_MODEL_VISION) ?? (core ? general : DEFAULTS.vision),
    long_context:
      nonEmpty(process.env.LUKAS_MODEL_LONG_CONTEXT) ?? (core ? reasoning : DEFAULTS.long_context),
  };
  return parseModelSpec(specs[profile], profile, reason);
}

function providerAvailable(provider: LukasProvider): boolean {
  if (provider === "openai") return true;
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  return Boolean(
    process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim(),
  );
}

function fallback(route: ModelRoute): ModelRoute {
  if (providerAvailable(route.provider)) return route;
  const general = configured("general", `${route.provider} nicht konfiguriert; stabiler Fallback`);
  if (providerAvailable(general.provider)) return general;
  return parseModelSpec(
    `openai:${nonEmpty(process.env.LUKAS_CORE_MODEL) ?? "gpt-4o"}`,
    "general",
    "Provider-Key fehlt; OpenAI-Core als letzter Fallback",
  );
}

function looksLikeCode(text: string): boolean {
  return /\b(code|coding|typescript|javascript|python|react|node|npm|pnpm|git|github|repo|repository|docker|sql|api|endpoint|bug|fehler|stacktrace|build|deploy|server|vps|ssh|systemd|nginx|caddy|funktion|klasse|datei|commit|branch)\b/i.test(
    text,
  );
}

function looksComplex(text: string): boolean {
  return (
    text.length > 1200 ||
    /\b(analysier|analyse|begründe|vergleiche|strategie|architektur|konzept|plane|planen|komplex|beweise|research|reason|trade-?off|debug|ursache|warum genau)\b/i.test(
      text,
    )
  );
}

function looksSimple(text: string): boolean {
  return text.length < 260 && !looksLikeCode(text) && !looksComplex(text) && !/[?].*[?]/s.test(text);
}

/** Lukas waehlt intern den passenden Rechenkern fuer die eigentliche Arbeit. */
export function routeLukasModel(input: RouteInput): ModelRoute {
  const text = input.userText ?? "";
  const tools = new Set(input.usedTools ?? []);

  let route: ModelRoute;
  if (input.hasAttachments || (input.attachmentKinds?.length ?? 0) > 0) {
    route = configured("vision", "multimodaler Inhalt");
  } else if (
    tools.has("execute_command") ||
    tools.has("github_read_path") ||
    tools.has("github_search_code") ||
    looksLikeCode(text)
  ) {
    route = configured("code", "Code/Repo/VPS-Aufgabe");
  } else if (text.length > 12000) {
    route = configured("long_context", "sehr grosser Kontext");
  } else if (looksComplex(text)) {
    route = configured("reasoning", "komplexe Analyse/Planung");
  } else if (looksSimple(text)) {
    route = configured("fast", "einfache Unterhaltung");
  } else {
    route = configured("general", "allgemeine Unterhaltung");
  }

  const resolved = fallback(route);
  logger.info(
    {
      provider: resolved.provider,
      model: resolved.model,
      profile: resolved.profile,
      reason: resolved.reason,
      iteration: input.iteration ?? 0,
    },
    "Lukas model route",
  );
  return resolved;
}

/**
 * Die sichtbare Stimme bleibt absichtlich stabil, auch wenn intern mehrere
 * Spezialmodelle gearbeitet haben. Der Nutzer bekommt nur diese Lukas-Schicht.
 */
export function routeLukasVoiceModel(): ModelRoute {
  const core = nonEmpty(process.env.LUKAS_CORE_MODEL) ?? "gpt-4o";
  const spec =
    nonEmpty(process.env.LUKAS_MODEL_VOICE, process.env.LUKAS_MODEL_GENERAL) ?? `openai:${core}`;
  return fallback(parseModelSpec(spec, "general", "stabile Lukas-Ausgabestimme"));
}

/*
 * Modell-ID fuer direkte OpenAI-Aufrufe, die nicht durch callLukasModel gehen
 * (Reflexion, Moltbook-Entscheidung, Studio-Prompt).
 *
 * Diese Stellen hatten `process.env.LUKAS_CORE_MODEL ?? "gpt-4o"` fest
 * eingebaut. Seit LUKAS_CORE_MODEL normalerweise leer ist, waeren sie damit
 * dauerhaft auf gpt-4o haengengeblieben, waehrend der Chat laengst auf der
 * 5.6-Familie laeuft — zwei Modellstaende im selben System, ohne dass es
 * jemandem auffaellt.
 */
export function directModel(profile: ModelProfile = "general"): string {
  return configured(profile, "direkter Aufruf ohne Router").model;
}

/**
 * Die volle Route zu einem Profil — ohne die Heuristik zu befragen.
 *
 * Fuer Rollen, deren Aufgabe schon feststeht: der Entwickler gehoert auf das
 * Code-Modell, der Fehleranalyst auf das Reasoning-Modell. Die Heuristik sieht
 * nur den Nutzertext und koennte das gar nicht wissen.
 */
export function directRoute(profile: ModelProfile): ModelRoute {
  return configured(profile, `feste Rolle: ${profile}`);
}
