// Fehlerprotokoll fuer die oeffentlichen/kritischen Routen — im Dashboard
// einsehbar (GET /api/lukas/debug-log), damit Fehlerursachen (z.B. beim
// ElevenLabs Custom-LLM-Test) ohne Railway-Log-Zugriff sichtbar sind.
// Liegt in der DB statt im Arbeitsspeicher: Railway startet den Container bei
// JEDER Variablenaenderung neu, ein In-Memory-Puffer waere praktisch immer
// leer, sobald man ihn sich ansieht.

import { db } from "@workspace/db";
import { debugLogTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { logger } from "./logger";

export interface DebugLogEntry {
  time: string;
  scope: string;
  message: string;
}

// Fire-and-forget: ein DB-Fehler beim Protokollieren darf nie die eigentliche
// Fehlerbehandlung des Aufrufers stoeren.
export function recordDebugEvent(scope: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  db.insert(debugLogTable)
    .values({ scope, message })
    .catch((dbErr) => logger.warn({ dbErr }, "Debug-Log konnte nicht gespeichert werden"));
}

export async function getDebugLog(): Promise<DebugLogEntry[]> {
  const rows = await db
    .select()
    .from(debugLogTable)
    .orderBy(desc(debugLogTable.createdAt))
    .limit(50);
  return rows.map((r) => ({ time: r.createdAt.toISOString(), scope: r.scope, message: r.message }));
}
