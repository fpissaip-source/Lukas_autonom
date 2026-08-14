import type OpenAI from "openai";
import { allLukasTools, executeLukasTool } from "./lukas-tools";
import { buildSystemPrompt } from "./system-prompt";
import { recordEmotion } from "./emotion-engine";
import { logger } from "./logger";
import { routeLukasModel, directRoute } from "./ai/model-router";
import { callLukasModel } from "./ai/model-client";
import { renderLukasVoice } from "./ai/voice-renderer";
import { Arbeitsschleife } from "./arbeitsschleife";

/*
 * Ein Lukas-Durchlauf ohne Streaming — fuer Kanaele wie WhatsApp.
 * Spezialmodelle arbeiten intern. Sichtbar wird ausschliesslich die stabile
 * Lukas-Ausgabeschicht, damit Providerwechsel keine Identitaetswechsel werden.
 */

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
  /*
   * Festes Modellprofil statt der Routing-Heuristik. Ein Code-Auftrag gehoert
   * auf das Code-Modell — die Heuristik kennt nur den Nutzertext und wuesste
   * nicht, dass hier ein Entwickler am Werk sein soll.
   */
  profil?: "code" | "reasoning" | "general" | "fast";
}): Promise<string> {
  const systemPrompt =
    opts.systemPromptOverride ?? (await buildSystemPrompt(opts.userText.slice(0, 1000)));
  const tools = opts.tools ?? (await allLukasTools());
  const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...opts.history,
  ];

  const textPieces: string[] = [];
  const usedTools: string[] = [];
  const hasAttachments = historyHasMultimodal(opts.history);

  /*
   * Keine feste Rundenzahl mehr. Er arbeitet, solange er vorankommt; wenn er
   * sich wiederholt, bekommt er das gesagt statt abgeschnitten zu werden.
   */
  const schleife = new Arbeitsschleife();
  while (schleife.darfWeiter()) {
    const i = schleife.naechsteRunde();
    const route = opts.profil
      ? { ...directRoute(opts.profil), profile: opts.profil }
      : routeLukasModel({
          userText: opts.userText,
          hasAttachments,
          usedTools,
          iteration: i,
        });
    // Budget bewusst offen lassen — siehe callOpenAI: bei Reasoning-Modellen
    // teilen sich Denken und Antwort dasselbe max_output_tokens.
    const result = await callLukasModel({
      route,
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

    /*
     * Hinweise JETZT berechnen, aber erst NACH den Tool-Ergebnissen einfuegen.
     *
     * Auf eine Assistenten-Nachricht mit tool_calls muessen unmittelbar die
     * zugehoerigen Ergebnisse folgen — schiebt man eine System-Nachricht
     * dazwischen, weist die API den ganzen Aufruf zurueck.
     */
    const hinweise = schleife.hinweise(result.toolCalls);

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

    convo.push(...hinweise);
  }

  if (schleife.notbremseGriff()) {
    logger.warn({ runden: schleife.rundenZahl }, "Notbremse gegriffen — echte Endlosschleife?");
  }

  /*
   * Leer heisst nicht "nichts zu sagen" — es heisst, dass er bis zuletzt
   * gearbeitet hat.
   *
   * Genau das stand im Dashboard: "Macher hat nichts zurückgegeben." Der
   * Mitarbeiter hatte seine Runden mit Werkzeugaufrufen verbracht, und in einer
   * Werkzeugrunde entsteht kein Text. Im Chat kam deshalb nichts an, obwohl er
   * die ganze Zeit etwas getan hat.
   *
   * Also eine letzte Runde OHNE Werkzeuge. Ohne Werkzeuge bleibt ihm nichts,
   * als zu formulieren, was er herausgefunden hat.
   */
  let draft = textPieces.join("\n\n").trim();

  if (!draft) {
    logger.info({ usedTools }, "Durchlauf ohne Text — Abschlussrunde ohne Werkzeuge");
    try {
      const letzte = await callLukasModel({
        route: routeLukasModel({
          userText: opts.userText,
          hasAttachments,
          usedTools,
          iteration: schleife.rundenZahl,
        }),
        messages: [
          ...convo,
          {
            role: "system",
            content:
              "Für diesen Zug stehen dir keine Werkzeuge mehr zur Verfügung. Antworte JETZT in " +
              "Worten: was hast du getan, was ist dabei herausgekommen, was hat nicht " +
              "funktioniert und woran lag es. Ein ehrliches „das ging nicht, weil X“ ist " +
              "brauchbar — gar nichts zu sagen ist es nicht.",
          },
        ],
      });
      draft = (letzte.content || "").trim();
    } catch (err) {
      logger.warn({ err }, "Abschlussrunde fehlgeschlagen");
    }
  }

  if (!draft) return "";
  return renderLukasVoice({ systemPrompt, conversation: convo, draft });
}
