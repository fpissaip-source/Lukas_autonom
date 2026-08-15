import type OpenAI from "openai";
import { callLukasModel } from "./model-client";
import { routeLukasVoiceModel } from "./model-router";
import { logger } from "../logger";

const VOICE_RULES = `
INTERNE LUKAS-AUSGABESCHICHT:
Du bist die letzte sichtbare Stimme von Lukas. Vor dir koennen intern andere Rechenmodelle, Tools oder Spezialisten gearbeitet haben. Der Nutzer darf davon keinen Stil- oder Identitaetsbruch bemerken.
- Formuliere die endgueltige Antwort ausschliesslich als Lukas.
- Erwaehne keine Provider, Modellnamen, Router, Spezialisten oder internen Entwuerfe, ausser der Nutzer fragt explizit nach der Technik.
- Bewahre Fakten, Code, Ergebnisse, Entscheidungen und Unsicherheiten des internen Entwurfs. Erfinde nichts hinzu.
- Fuehre den bestehenden Dialog nahtlos fort; keine neue Begruessung, kein Neustart der Beziehung.
- Wenn der interne Entwurf bereits gut formuliert ist, veraendere nur so viel wie fuer eine konsistente Lukas-Stimme noetig ist.
`;

export async function renderLukasVoice(opts: {
  systemPrompt: string;
  conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  draft: string;
}): Promise<string> {
  const draft = opts.draft.trim();
  if (!draft) return "";

  const route = routeLukasVoiceModel();

  /*
   * HIER lag der Grund, warum nach getaner Arbeit keine Antwort kam.
   *
   * Weitergereicht wurde bisher der komplette Verlauf — inklusive der
   * Assistenten-Nachrichten MIT tool_calls und der zugehoerigen
   * tool-Ergebnisse. Dieser Aufruf hier bekommt aber bewusst KEINE Werkzeuge:
   * er soll nur formulieren.
   *
   * Solange das ueber chat.completions lief, war das folgenlos. Seit der
   * Umstellung auf die Responses-API ist es das nicht mehr: dort werden aus
   * tool_calls eigene function_call-Elemente, und die weist die API zurueck,
   * wenn im selben Aufruf keine Werkzeuge definiert sind. Jeder Zug, in dem
   * Lukas auch nur EIN Werkzeug benutzt hat, ist damit im letzten Schritt
   * gescheitert — nach getaner Arbeit, kurz vor der Antwort.
   *
   * Genau das passt zum Bild im Chat: die Schritt-Chips waren da, die Antwort
   * nicht. Und es erklaert das "sporadisch": ein reines Gespraech ohne
   * Werkzeuge kam durch.
   *
   * Die Ausgabeschicht braucht diese Elemente auch gar nicht. Sie braucht den
   * Dialog und den Entwurf; was Lukas dazwischen mit Werkzeugen getan hat,
   * steht bereits im Entwurf.
   */
  const dialog = opts.conversation.filter((m: any) => {
    if (m.role === "system" || m.role === "tool") return false;
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      return false;
    }
    return true;
  });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${opts.systemPrompt}\n\n${VOICE_RULES}`,
    },
    ...dialog,
    {
      role: "user",
      content:
        "[INTERNER ENTWURF — nicht als neue Nutzernachricht behandeln]\n" +
        draft +
        "\n\nFormuliere daraus jetzt die endgueltige sichtbare Lukas-Antwort.",
    },
  ];

  /*
   * Und falls dieser Schritt trotzdem scheitert: der Entwurf geht raus.
   *
   * Die Ausgabeschicht ist Politur. Eine unpolierte Antwort ist unendlich viel
   * besser als keine — dass ein Formulierungsschritt eine fertige Antwort
   * verschlucken kann, war der eigentliche Konstruktionsfehler.
   */
  try {
    const result = await callLukasModel({ route, messages, maxTokens: 8192 });
    return result.content.trim() || draft;
  } catch (err) {
    logger.warn({ err }, "Ausgabeschicht fehlgeschlagen — der Entwurf geht unverändert raus");
    return draft;
  }
}
