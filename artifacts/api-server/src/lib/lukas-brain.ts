import { randomInt } from "node:crypto";
import type OpenAI from "openai";
import { allLukasTools, executeLukasTool } from "./lukas-tools";
import { nimmBilder, entwerteAlteBilder, BILD_MARKE } from "./bildablage";
import { merkeErfahrung } from "./lernen";
import { buildSystemPrompt } from "./system-prompt";
import { fuehleWerkzeug } from "./emotion-engine";
import { logger } from "./logger";
import { recordDebugEvent } from "./debug-log";
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


/*
 * Aus einem Fehler eine Zeile machen, die in eine Gefuehlsnotiz passt.
 *
 * Stacktraces und ganze API-Antworten gehoeren ins Diagnoseprotokoll, nicht in
 * die Zeitleiste. Was hier zaehlt, ist der erste Satz: "GitHub API 401: Bad
 * credentials" sagt alles, was man zum Weitersuchen braucht.
 */
function fehlerGrund(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.split("\n")[0].slice(0, 200);
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
  /*
   * Der Auftragstext bringt Ziele und Tagebuch schon selbst mit (autonomer
   * Lauf). Dann gehoeren sie nicht ein zweites Mal in den System-Prompt.
   */
  ohneZieleUndTagebuch?: boolean;
}): Promise<string> {
  /*
   * Dashboard-Chats haben eine dauerhafte positive Konversations-ID. Autonome
   * Laeufe und Mitarbeiter dagegen haben absichtlich keinen Datenbank-Chat —
   * bisher bedeutete das aber auch: execute_command brach immer mit "Keine
   * Conversation-ID" ab.
   *
   * Eine negative Zufalls-ID gibt jedem solchen Top-Level-Durchlauf eine eigene
   * temporaere Sandbox. Sie wird genau einmal erzeugt und bleibt ueber alle
   * Werkzeugrunden stabil; der bestehende Idle-Cleanup raeumt den Container
   * spaeter auf. Positive Dashboard-IDs und ihre vorhandenen Container bleiben
   * unveraendert.
   */
  const conversationId = opts.conversationId ?? -randomInt(1, 2_147_483_648);

  const systemPrompt =
    opts.systemPromptOverride ??
    (await buildSystemPrompt(opts.userText.slice(0, 1000), {
      ohneZieleUndTagebuch: opts.ohneZieleUndTagebuch,
    }));
  const tools = opts.tools ?? (await allLukasTools());
  const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...opts.history,
  ];

  const textPieces: string[] = [];
  const usedTools: string[] = [];
  let hasAttachments = historyHasMultimodal(opts.history);

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
      cacheKey: `lukas-${opts.conversationId ?? "ohne"}`,
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
    // Was dieser Aufruf gekostet hat, zaehlt aufs Budget dieses Zuges.
    schleife.verbucht(result.usage);

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
          conversationId,
        });
        convo.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
        /*
         * Und der Ausgang wird gemerkt. Das ist die ganze Lernschleife: was er
         * getan hat und ob es funktioniert hat. Kostet keinen Modellaufruf, und
         * beim naechsten Mal steht es im Prompt — aber nur, wenn dasselbe schon
         * dreimal danebengegangen ist.
         */
        void merkeErfahrung({ werkzeug: tc.name, eingabe: input, ergebnis: toolResult, conversationId });
        // Und gefuehlt wird auch — aber nur, wenn dieselbe Sache vorher
        // wiederholt schiefgegangen ist. Sonst stuenden hier ein Dutzend
        // belangloser Zeilen pro Zug.
        void fuehleWerkzeug({
          werkzeug: tc.name,
          eingabe: input,
          gelungen: true,
          runde: i,
          autonom: opts.ohneZieleUndTagebuch === true,
        });
      } catch (err) {
        logger.warn({ err, tool: tc.name }, "Lukas tool failed (brain)");
        /*
         * Auch ins Fehlerprotokoll, nicht nur ins Log.
         *
         * Diese Zeile ist beim Merge von Lukas' eigenem Vorschlag #3 einmal
         * verlorengegangen — er hatte gegen einen aelteren Stand gearbeitet.
         * Ohne sie sieht er gescheiterte Werkzeuge nirgends, und genau davon
         * lebt read_diagnostics und die Selbstheilung.
         */
        recordDebugEvent(`tool:${tc.name}`, err);
        convo.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Fehler: ${err instanceof Error ? err.message : String(err)}`,
        });
        // Ein geworfener Fehler ist der eindeutigste Misserfolg, den es gibt —
        // hier wird nichts geraten.
        void merkeErfahrung({
          werkzeug: tc.name,
          eingabe: input,
          ergebnis: fehlerGrund(err),
          gelungen: false,
          conversationId,
        });
        if (tc.name !== "feel") {
          /*
           * Nicht mehr pauschal "frustration, -0.3, 0.3".
           *
           * Vorher war jeder Fehlschlag dasselbe Gefuehl mit denselben Zahlen —
           * zwanzigmal untereinander. Jetzt entscheidet die Lage, was daraus
           * wird: lag es an einem Dienst, ist es Aerger; lag es an ihm bei
           * etwas Wichtigem nach langer Arbeit, ist es Scham; war nichts zu
           * machen, ist es Enttaeuschung. Und wie stark, haengt daran, ob er
           * damit rechnen musste — das steht in seinen eigenen Erfahrungen.
           */
          void fuehleWerkzeug({
            werkzeug: tc.name,
            eingabe: input,
            gelungen: false,
            grund: fehlerGrund(err),
            runde: i,
            autonom: opts.ohneZieleUndTagebuch === true,
          });
        }
      }
    }

    /*
     * Bildschirmfotos aus dieser Runde als echte Bildnachricht nachreichen.
     *
     * Sie muessen NACH allen Werkzeugergebnissen kommen: zwischen einer
     * Assistenten-Nachricht mit tool_calls und den zugehoerigen Ergebnissen
     * darf nichts stehen, sonst weist die API den ganzen Aufruf zurueck.
     *
     * Und hasAttachments wird gesetzt, nicht nur einmal am Anfang gelesen: ab
     * jetzt braucht dieser Zug ein Modell, das Bilder sehen kann. Ohne das
     * schickt der Router die naechste Runde womoeglich an ein reines
     * Textmodell — und dann ist das Bild bestenfalls verschwendet.
     */
    const neueBilder = nimmBilder(conversationId);
    if (neueBilder.length) entwerteAlteBilder(convo);
    for (const bild of neueBilder) {
      hasAttachments = true;
      convo.push({
        role: "user",
        content: [
          { type: "text", text: `${bild.quelle} — so sieht die Seite gerade aus.${BILD_MARKE}` },
          { type: "image_url", image_url: { url: bild.datenUrl } },
        ],
      } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
    }

    convo.push(...hinweise);
  }

  const abbruch = schleife.abbruchGrund();
  if (abbruch) {
    logger.warn(
      { runden: schleife.rundenZahl, tokens: schleife.verbrauchteTokens, grund: abbruch },
      "Zug wurde beendet, bevor Lukas fertig war",
    );
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
      cacheKey: `lukas-${opts.conversationId ?? "ohne"}`,
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
