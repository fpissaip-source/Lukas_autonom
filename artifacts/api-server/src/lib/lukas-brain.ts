import type OpenAI from "openai";
import { openai } from "@workspace/integrations-openai-ai";
import { LUKAS_TOOLS, executeLukasTool } from "./lukas-tools";
import { buildSystemPrompt } from "./system-prompt";
import { recordEmotion } from "./emotion-engine";
import { logger } from "./logger";

/*
 * Ein Lukas-Durchlauf ohne Streaming — fuer Kanaele, die keine SSE-Verbindung
 * haben und einfach nur eine fertige Antwort brauchen (WhatsApp).
 *
 * Nutzt bewusst denselben System-Prompt und dieselben Tools wie der
 * Dashboard-Chat: es soll derselbe Lukas sein, mit demselben Gedaechtnis,
 * denselben Gefuehlen und denselben Faehigkeiten — nur ueber einen anderen
 * Kanal. Der Streaming-Pfad in routes/anthropic.ts bleibt unangetastet, weil
 * das Dashboard die Token live anzeigen soll.
 */

const CHAT_MODEL = process.env.LUKAS_CORE_MODEL ?? "gpt-4o";
const MAX_TOOL_ITERATIONS = 8;

export async function runLukasTurn(opts: {
  history: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  userText: string;
  conversationId?: number;
}): Promise<string> {
  const systemPrompt = await buildSystemPrompt(opts.userText.slice(0, 500));
  const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...opts.history,
  ];

  const textPieces: string[] = [];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      max_completion_tokens: 4096,
      tools: LUKAS_TOOLS,
      messages: convo,
    });

    const choice = response.choices[0];
    if (!choice) break;
    if (choice.message.content) textPieces.push(choice.message.content);

    const toolCalls = choice.message.tool_calls ?? [];
    if (choice.finish_reason !== "tool_calls" || toolCalls.length === 0) break;

    convo.push(choice.message);

    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      let input: Record<string, unknown> = {};
      try {
        input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        // Kaputtes JSON vom Modell — das Tool meldet fehlende Felder selbst.
      }
      try {
        const result = await executeLukasTool(tc.function.name, input, {
          rawUserMessage: opts.userText,
          conversationId: opts.conversationId,
        });
        convo.push({ role: "tool", tool_call_id: tc.id, content: result });
      } catch (err) {
        logger.warn({ err, tool: tc.function.name }, "Lukas tool failed (brain)");
        convo.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Fehler: ${err instanceof Error ? err.message : String(err)}`,
        });
        if (tc.function.name !== "feel") {
          recordEmotion({
            emotion: "frustration",
            valence: -0.3,
            intensity: 0.3,
            cause: `Tool ${tc.function.name} ist fehlgeschlagen`,
            source: "tool",
          }).catch(() => {});
        }
      }
    }
  }

  return textPieces.join("\n\n").trim();
}
