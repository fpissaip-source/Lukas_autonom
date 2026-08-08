import type OpenAI from "openai";
import { callLukasModel } from "./model-client";
import { routeLukasVoiceModel } from "./model-router";

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
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${opts.systemPrompt}\n\n${VOICE_RULES}`,
    },
    ...opts.conversation.filter((m) => m.role !== "system"),
    {
      role: "user",
      content:
        "[INTERNER ENTWURF — nicht als neue Nutzernachricht behandeln]\n" +
        draft +
        "\n\nFormuliere daraus jetzt die endgueltige sichtbare Lukas-Antwort.",
    },
  ];

  const result = await callLukasModel({ route, messages, maxTokens: 8192 });
  return result.content.trim() || draft;
}
