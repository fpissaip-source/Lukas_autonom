import { db } from "@workspace/db";
import { memoriesTable } from "@workspace/db";
import { logger } from "./logger";

/*
 * Jede Nachricht von Issa wandert automatisch ins Gedaechtnis — sein
 * ausdruecklicher Wunsch ("alles was ich schreibe soll gespeichert werden").
 *
 * Bewusst eigene Kategorie "conversation" statt unter die kuratierten
 * Erinnerungen zu mischen: der System-Prompt zieht sonst als "neueste
 * Erinnerungen" nur noch Chat-Schnipsel und verdraengt damit die wirklich
 * wichtigen Fakten ueber Issa. Als eigene Kategorie bleibt alles vollstaendig
 * erhalten und ueber die Gedaechtnissuche (query_memory / memoryContextFor)
 * auffindbar, ohne den Kontext zuzumuellen.
 *
 * Der save_memory-Tool-Aufruf bleibt davon unberuehrt: was Lukas selbst als
 * wichtig einstuft, landet weiterhin mit hoeherer Wichtigkeit in seiner
 * regulaeren Erinnerung.
 */
export const CONVERSATION_CATEGORY = "conversation";

export async function rememberUserMessage(
  content: string,
  source: "dashboard" | "whatsapp" | "voice" = "dashboard",
): Promise<void> {
  const text = content.trim();
  if (!text) return;
  try {
    await db.insert(memoriesTable).values({
      content: text.slice(0, 4000),
      category: CONVERSATION_CATEGORY,
      // Niedrige Grundwichtigkeit: es ist ein Gespraechsmitschnitt, kein
      // kuratierter Fakt. Laengere Nachrichten enthalten meist mehr Substanz.
      importance: text.length > 200 ? 4 : 3,
      tags: ["chat", source],
    });
  } catch (err) {
    // Ein fehlgeschlagener Gedaechtnis-Eintrag darf niemals das Gespraech
    // abbrechen — nur loggen.
    logger.warn({ err, source }, "Nachricht konnte nicht ins Gedächtnis geschrieben werden");
  }
}
