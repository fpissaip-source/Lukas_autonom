import { db } from "@workspace/db";
import { memoriesTable } from "@workspace/db";
import { logger } from "./logger";

/*
 * Der kanonische Chat-Verlauf liegt in der messages-Tabelle. Zusaetzlich wird
 * jede Seite des Gespraechs als niedrig gewichtete Conversation-Erinnerung
 * abgelegt, damit Lukas auch ueber Thread-/Provider-Grenzen hinweg alte
 * Formulierungen semantisch wiederfinden kann.
 *
 * WICHTIG: Modelle besitzen dieses Gedaechtnis nicht. GPT/Claude/Gemini sind
 * austauschbare Rechenkerne; die persistente Erinnerung gehoert Lukas.
 */
export const CONVERSATION_CATEGORY = "conversation";
export type ConversationSource = "dashboard" | "whatsapp" | "voice";
export type ConversationRole = "user" | "assistant";

/*
 * Nachrichten, die nichts zu erinnern geben.
 *
 * Ein "?" oder ein "ok" ist Gespraechsfuehrung, kein Inhalt. Im Gedaechtnis
 * steht danach "Issa: ?" — das hilft bei keiner spaeteren Suche und schiebt
 * echte Erinnerungen aus der Liste. Genau das war im Dashboard zu sehen.
 *
 * Bewusst eng gehalten: kurz ALLEIN reicht nicht als Grund. "Nein.", "Merge"
 * oder eine Telefonnummer sind kurz und trotzdem wichtig. Aussortiert wird
 * nur, was ohne Bezug gar keine Aussage traegt.
 */
const OHNE_INHALT = [
  /^[?!.,;:\s]+$/, // reine Satzzeichen
  /*
   * Ja/Nein/Nö stehen hier BEWUSST NICHT drin.
   *
   * Sie sind kurz, aber sie sind eine Entscheidung — und eine verlorene
   * Entscheidung wiegt schwerer als eine belanglose Erinnerung zu viel. Die
   * Pruefung haelt das fest; mein erster Wurf hatte "nein" mit aussortiert.
   */
  /^(ok|okay|oki|jo|joa|hm+|äh+|ah+|aha|jup|jap|yep|k|kk)[?!.\s]*$/i,
  /^(danke|thx|top|super|nice|geil|passt|alles klar|verstanden)[?!.\s]*$/i,
  /^(hi|hey|hallo|moin|servus|tschüss|ciao|bye|gn8|gute nacht)[?!.\s]*$/i,
  /^(\p{Extended_Pictographic}|\s)+$/u, // nur Emoji
];

export function istErinnerungswert(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Alles ab einem vollen Satz kommt gar nicht erst in die Pruefung.
  if (t.length > 40) return true;
  return !OHNE_INHALT.some((re) => re.test(t));
}

export async function rememberConversationMessage(
  content: string,
  role: ConversationRole,
  source: ConversationSource = "dashboard",
): Promise<void> {
  const text = content.trim();
  if (!text) return;
  // Lukas' eigene Antworten bleiben drin — die tragen immer Inhalt.
  if (role === "user" && !istErinnerungswert(text)) return;
  try {
    const prefix = role === "user" ? "Issa" : "Lukas";
    await db.insert(memoriesTable).values({
      content: `${prefix}: ${text}`.slice(0, 4000),
      category: CONVERSATION_CATEGORY,
      // Chat-Mitschnitte bleiben niedriger gewichtet als kuratierte Fakten.
      importance: text.length > 200 ? 4 : 3,
      tags: ["chat", source, role],
    });
  } catch (err) {
    // Memory darf niemals den eigentlichen Chat abbrechen.
    logger.warn({ err, source, role }, "Nachricht konnte nicht ins Gedächtnis geschrieben werden");
  }
}

export async function rememberUserMessage(
  content: string,
  source: ConversationSource = "dashboard",
): Promise<void> {
  return rememberConversationMessage(content, "user", source);
}

export async function rememberAssistantMessage(
  content: string,
  source: ConversationSource = "dashboard",
): Promise<void> {
  return rememberConversationMessage(content, "assistant", source);
}
