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

function configured(profile: ModelProfile, reason: string): ModelRoute {
  const core = process.env.LUKAS_CORE_MODEL ?? "gpt-4o";
  const general = process.env.LUKAS_MODEL_GENERAL ?? `openai:${core}`;
  const specs: Record<ModelProfile, string> = {
    fast:
      process.env.LUKAS_MODEL_FAST ??
      `openai:${process.env.LUKAS_FAST_MODEL ?? process.env.LUKAS_PUBLIC_MODEL ?? "gpt-4o-mini"}`,
    general,
    reasoning: process.env.LUKAS_MODEL_REASONING ?? general,
    code: process.env.LUKAS_MODEL_CODE ?? process.env.LUKAS_MODEL_REASONING ?? general,
    vision: process.env.LUKAS_MODEL_VISION ?? general,
    long_context: process.env.LUKAS_MODEL_LONG_CONTEXT ?? process.env.LUKAS_MODEL_REASONING ?? general,
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
    `openai:${process.env.LUKAS_CORE_MODEL ?? "gpt-4o"}`,
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
  const core = process.env.LUKAS_CORE_MODEL ?? "gpt-4o";
  const spec = process.env.LUKAS_MODEL_VOICE ?? process.env.LUKAS_MODEL_GENERAL ?? `openai:${core}`;
  return fallback(parseModelSpec(spec, "general", "stabile Lukas-Ausgabestimme"));
}
