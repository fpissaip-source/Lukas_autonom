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

export async function rememberConversationMessage(
  content: string,
  role: ConversationRole,
  source: ConversationSource = "dashboard",
): Promise<void> {
  const text = content.trim();
  if (!text) return;
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
