import { logger } from "../logger";

/*
 * "local" ist kein eigener Anbieter, sondern JEDER Dienst, der die
 * OpenAI-Schnittstelle spricht: Ollama und llama.cpp auf Issas Droplet, vLLM,
 * LM Studio, oder ein Anbieter, der offene Modelle hostet.
 *
 * Damit haengt Lukas nicht mehr an einem einzigen Konto. Wohin die Aufrufe
 * gehen, sagt LUKAS_LOCAL_BASE_URL — der Code hier muss davon nichts wissen.
 */
export type LukasProvider = "openai" | "anthropic" | "google" | "local";
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
    if (
      (provider === "openai" ||
        provider === "anthropic" ||
        provider === "google" ||
        provider === "local") &&
      model
    ) {
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

export function localBaseUrl(): string | undefined {
  return process.env.LUKAS_LOCAL_BASE_URL?.trim() || undefined;
}

function providerAvailable(provider: LukasProvider): boolean {
  if (provider === "openai") return true;
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  /*
   * Kein Schluessel, sondern eine Adresse: ein lokaler Server hat meistens gar
   * keine Anmeldung. Fehlt die Adresse, faellt der Aufruf ueber fallback()
   * automatisch auf OpenAI zurueck — ein abgeschalteter Ollama legt Lukas also
   * nicht lahm, er wird nur wieder teurer.
   */
  if (provider === "local") return Boolean(localBaseUrl());
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

/*
 * Ist das wirklich eine Code-Aufgabe?
 *
 * Die alte Liste enthielt "fehler", "datei", "server", "api" und "funktion" —
 * Woerter, die in fast jeder deutschen Nachricht ueber dieses System
 * vorkommen. "Der Fehler nervt mich" und "Schick mir bitte eine Datei" landeten
 * damit auf dem teuersten Modell. Das war kein Randfall, sondern der
 * Normalfall, und es hat still Geld gekostet.
 *
 * Deshalb zwei Stufen: eindeutige Fachbegriffe reichen fuer sich. Woerter, die
 * auch im Alltag vorkommen, zaehlen nur zusammen mit einer Taetigkeit —
 * "die Datei" ist Alltag, "die Datei debuggen" ist Arbeit.
 */
const CODE_EINDEUTIG =
  /\b(typescript|javascript|python|react|npm|pnpm|github|repository|docker|stacktrace|nginx|caddy|systemd|ssh|sql|commit|pull request|merge|refactor|regex|json|yaml|bash|shell|cli|migration|cron|async|await|webpack|vite|eslint|tsc)\b/i;

/*
 * Syntax und Dateinamen sind der eindeutigste Hinweis ueberhaupt — und der
 * fehlte.
 *
 * Der Benchmark (bench/faelle/routing.mjs) hat es gemessen: elf von fuenfzehn
 * Code-Aufgaben landeten auf dem schnellen Modell, darunter
 * "const x = foo.map(y => y.id) — warum ist x undefined?" und
 * "Fix den TypeError in Zeile 42 von browser.ts". Beides ist unuebersehbar
 * Code, aber keines der Fachwoerter oben kommt darin vor. Wer Quelltext
 * einfuegt, bekommt so das schwaechste Modell — genau verkehrt herum.
 */
const CODE_SYNTAX =
  /(=>|;\s*$|\{\s*$|\bconst\b|\blet\b|\bfunction\b|\bimport\b|\bexport\b|\breturn\b|`{3}|\bSELECT\b.*\bFROM\b|\.(ts|tsx|js|jsx|mjs|py|sh|sql|go|rs|java|css|html)\b|[A-Za-z]+Error\b|\bexit code\b|\bmodule not found\b)/im;

const CODE_ALLTAG =
  /\b(code|api|endpoint|bug|fehler|build|deploy|server|vps|funktion|klasse|datei|branch|repo|git|node|test|tests|skript|script|logik|spalte|tabelle|container|job)\b/i;

const CODE_TAETIGKEIT =
  /\b(schreib|baue?|bauen|implementier|programmier|debugg?e?|fix|behebe?|beheben|analysier|prüf|pruef|teste?n?|ändere?|aendere?|refactor|deploye?|installier)\w*/i;

function looksLikeCode(text: string): boolean {
  if (CODE_EINDEUTIG.test(text)) return true;
  if (CODE_SYNTAX.test(text)) return true;
  return CODE_ALLTAG.test(text) && CODE_TAETIGKEIT.test(text);
}

/*
 * Deutsche Beugung und Komposita — der Grund, warum "Analysiere ..." bisher
 * auf dem schnellen Modell landete.
 *
 * Die alte Fassung stand in \b...\b. Damit traf "Analyse", aber nicht
 * "Analysiere", "analysieren" oder "analysiert" — also ausgerechnet die
 * Formen, in denen man einen Auftrag formuliert. Dasselbe bei Komposita:
 * "Teststrategie" und "Systemarchitektur" fielen durch, weil vor "strategie"
 * ein Buchstabe steht und die Wortgrenze deshalb fehlt. Und "Trade-offs"
 * scheiterte am Plural-s.
 *
 * CODE_TAETIGKEIT machte es nebenan schon richtig (\w* am Ende) — die beiden
 * Regeln waren schlicht uneinheitlich. Gemessen hat das der Benchmark:
 * vier von zwoelf Analyse-Aufgaben gingen ans schnelle Modell.
 *
 * VORNE offen nur bei den Nomen, die typisch in Komposita stehen. Bei den
 * Verben waere es riskant (aus "Plan" wuerde jedes "...plan"), deshalb dort
 * nur hinten offen.
 */
const KOMPLEX =
  /(\b(analysier|analyse|begründ|begruend|vergleich|plan|beweis|research|reason|debug|ursach)\w*|\w*(strategie|architektur|konzept|analyse)\b|\btrade-?offs?\b|\bkomplex\w*|\bwarum genau\b|\bzerlege\b|\babwäg\w*)/i;

function looksComplex(text: string): boolean {
  return text.length > 1200 || KOMPLEX.test(text);
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
  /*
   * Der teuerste Fehler im ganzen System, und er stand in einer Zeile.
   *
   * Diese Schicht formuliert JEDE sichtbare Antwort — sie laeuft oefter als
   * jedes andere Modell hier, und mit dem kompletten Gespraech im Kontext. Der
   * Rueckfall war "gpt-4o", noch aus der Zeit vor der 5.6-Familie. Da
   * LUKAS_CORE_MODEL normalerweise leer ist, hiess das: die eigentliche Arbeit
   * lief auf terra und luna, und ausgerechnet der haeufigste Aufruf auf dem
   * alten, deutlich teureren Modell.
   *
   * Jetzt dieselbe Standardbesetzung wie ueberall sonst. Wer die Stimme
   * bewusst woanders hinlegen will, setzt LUKAS_MODEL_VOICE.
   */
  const spec =
    nonEmpty(
      process.env.LUKAS_MODEL_VOICE,
      process.env.LUKAS_MODEL_GENERAL,
      process.env.LUKAS_CORE_MODEL ? `openai:${process.env.LUKAS_CORE_MODEL.trim()}` : undefined,
    ) ?? DEFAULTS.general;
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
