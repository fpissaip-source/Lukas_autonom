import type OpenAI from "openai";
import { LUKAS_TOOLS, executeLukasTool } from "./lukas-tools";
import { buildSystemPrompt } from "./system-prompt";
import { recordEmotion } from "./emotion-engine";
import { logger } from "./logger";
import { routeLukasModel } from "./ai/model-router";
import { callLukasModel } from "./ai/model-client";
import { renderLukasVoice } from "./ai/voice-renderer";

/*
 * Ein Lukas-Durchlauf ohne Streaming — fuer Kanaele wie WhatsApp.
 * Spezialmodelle arbeiten intern. Sichtbar wird ausschliesslich die stabile
 * Lukas-Ausgabeschicht, damit Providerwechsel keine Identitaetswechsel werden.
 */

const MAX_TOOL_ITERATIONS = 8;

function historyHasMultimodal(history: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): boolean {
  return history.some((message: any) => Array.isArray(message.content));
}

export async function runLukasTurn(opts: {
  history: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  userText: string;
  conversationId?: number;
  /*
   * Fertiger System-Prompt statt Issas privatem. Wird fuer Gespraeche mit
   * Fremden benutzt (WhatsApp von einer unbekannten Nummer): dann darf NICHTS
   * Privates in den Kontext, also auch nicht ueber buildSystemPrompt().
   */
  systemPromptOverride?: string;
  /*
   * Werkzeuge fuer diesen Durchlauf. Standard: alle. Ein leeres Array heisst
   * "reines Gespraech" — das Modell bekommt dann gar nicht erst die
   * Moeglichkeit, etwas auszuloesen. Das ist die harte Grenze fuer Fremde:
   * kein Verlass auf eine Prompt-Anweisung, sondern schlicht keine Werkzeuge
   * im Aufruf.
   */
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
}): Promise<string> {
  const systemPrompt =
    opts.systemPromptOverride ?? (await buildSystemPrompt(opts.userText.slice(0, 1000)));
  const tools = opts.tools ?? LUKAS_TOOLS;
  const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...opts.history,
  ];

  const textPieces: string[] = [];
  const usedTools: string[] = [];
  const hasAttachments = historyHasMultimodal(opts.history);

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const route = routeLukasModel({
      userText: opts.userText,
      hasAttachments,
      usedTools,
      iteration: i,
    });
    const result = await callLukasModel({
      route,
      maxTokens: 8192,
      tools,
      messages: convo,
    });

    if (result.content) textPieces.push(result.content);
    if (result.toolCalls.length === 0) break;

    convo.push({
      role: "assistant",
      content: result.content || null,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    for (const tc of result.toolCalls) {
      usedTools.push(tc.name);
      let input: Record<string, unknown> = {};
      try {
        input = tc.arguments ? JSON.parse(tc.arguments) : {};
      } catch {
        // Kaputtes JSON vom Modell — das Tool meldet fehlende Felder selbst.
      }
      try {
        const toolResult = await executeLukasTool(tc.name, input, {
          rawUserMessage: opts.userText,
          conversationId: opts.conversationId,
        });
        convo.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
      } catch (err) {
        logger.warn({ err, tool: tc.name }, "Lukas tool failed (brain)");
        convo.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Fehler: ${err instanceof Error ? err.message : String(err)}`,
        });
        if (tc.name !== "feel") {
          recordEmotion({
            emotion: "frustration",
            valence: -0.3,
            intensity: 0.3,
            cause: `Tool ${tc.name} ist fehlgeschlagen`,
            source: "tool",
          }).catch(() => {});
        }
      }
    }
  }

  const draft = textPieces.join("\n\n").trim();
  if (!draft) return "";
  return renderLukasVoice({ systemPrompt, conversation: convo, draft });
}
