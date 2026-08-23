import type OpenAI from "openai";
import { logger } from "../logger";

/*
 * Wie viel Gespraech ueberhaupt mitgeschickt wird.
 *
 * Der Wert stand auf 220.000 Zeichen — rund 60.000 Tokens. Erreicht ein Thread
 * diese Groesse, wird er ab dann jede Runde in voller Laenge erneut bezahlt,
 * und ein Zug mit zehn Werkzeugrunden zehnmal. Fuer ein Modellfenster war das
 * grosszuegig gedacht; fuer die Rechnung ist es der teuerste Posten ueberhaupt.
 *
 * 60.000 Zeichen (~17.000 Tokens) sind ein langes Gespraech, nicht ein kurzes.
 * Was davor liegt, ist NICHT verloren: der Rohverlauf steht vollstaendig in der
 * Datenbank, und was zur aktuellen Nachricht passt, holt buildSystemPrompt
 * ueber memoryContextFor gezielt zurueck — plus query_memory, wenn Lukas
 * gezielt sucht. Gekuerzt wird also nur, was in DIESEM Aufruf mitfaehrt.
 */
const DEFAULT_MAX_CONTEXT_CHARS = Number(process.env.LUKAS_CONTEXT_MAX_CHARS ?? 60_000);

function contentCost(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 200;

  let total = 0;
  for (const part of content as any[]) {
    if (part?.type === "text") total += String(part.text ?? "").length;
    else if (part?.type === "image_url") total += 2500; // Bildtokens statt Base64-Laenge schaetzen.
    else if (part?.type === "file") total += 8000;
    else total += 500;
  }
  return total;
}

function messageCost(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): number {
  const m = message as any;
  let total = 100 + contentCost(m.content);
  if (Array.isArray(m.tool_calls)) {
    total += m.tool_calls.reduce(
      (sum: number, tc: any) =>
        sum + String(tc?.function?.name ?? "").length + String(tc?.function?.arguments ?? "").length + 100,
      0,
    );
  }
  return total;
}

function maxContextChars(): number {
  const raw = Number(process.env.LUKAS_CONTEXT_MAX_CHARS ?? DEFAULT_MAX_CONTEXT_CHARS);
  if (!Number.isFinite(raw)) return DEFAULT_MAX_CONTEXT_CHARS;
  return Math.max(12_000, Math.floor(raw));
}

/**
 * Alles bleibt dauerhaft in DB/Memory. Nur wenn ein Thread groesser als das
 * aktive Modellfenster wird, wird fuer DIESEN Modellaufruf ein Suffix gepackt.
 * Der aktuelle Turn bleibt immer drin; alte relevante Stellen kommen bereits
 * ueber buildSystemPrompt -> memoryContextFor aus dem Originalarchiv zurueck.
 */
export function fitLukasContext(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const maxChars = maxContextChars();
  const total = messages.reduce((sum, message) => sum + messageCost(message), 0);
  if (total <= maxChars) return messages;

  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");
  const systemCost = systemMessages.reduce((sum, message) => sum + messageCost(message), 0);
  const budget = Math.max(20_000, maxChars - systemCost - 1500);

  const kept: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  let used = 0;
  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const message = nonSystem[i];
    const cost = messageCost(message);
    // Die allerletzte Nachricht darf nie herausfallen, auch wenn ein grosser
    // Anhang allein den Schaetzwert uebersteigt.
    if (kept.length > 0 && used + cost > budget) break;
    kept.unshift(message);
    used += cost;
  }

  // Nie mitten in einer alten Tool-Sequenz anfangen.
  while (kept.length > 1 && kept[0].role === "tool") kept.shift();

  const dropped = nonSystem.length - kept.length;
  const archiveHint: OpenAI.Chat.Completions.ChatCompletionSystemMessageParam = {
    role: "system",
    content:
      `KONTEXTFENSTER-HINWEIS: ${dropped} ältere Nachrichten dieses Threads sind aus Platzgründen ` +
      `nicht wörtlich in diesem einzelnen Modellaufruf enthalten. Sie sind NICHT vergessen oder gelöscht: ` +
      `sie liegen im kanonischen Chat-Archiv und im Lukas-Gedächtnis. Relevante alte Originalstellen wurden ` +
      `für die aktuelle Frage bereits per Memory-Retrieval gesucht; bei weiterer Unsicherheit nutze query_memory.`,
  };

  logger.info({ totalCost: total, maxChars, dropped, kept: kept.length }, "Lukas context window packed");
  return [...systemMessages, archiveHint, ...kept];
}
