// Fehlerprotokoll fuer die oeffentlichen/kritischen Routen — im Dashboard
// einsehbar (GET /api/lukas/debug-log), damit Fehlerursachen (z.B. beim
// ElevenLabs Custom-LLM-Test) ohne Railway-Log-Zugriff sichtbar sind.
// Liegt in der DB statt im Arbeitsspeicher: Railway startet den Container bei
// JEDER Variablenaenderung neu, ein In-Memory-Puffer waere praktisch immer
// leer, sobald man ihn sich ansieht.

import { db } from "@workspace/db";
import { fehlerText } from "./fehlertext";
import { debugLogTable } from "@workspace/db";
import { desc, gte } from "drizzle-orm";
import { logger } from "./logger";

export interface DebugLogEntry {
  time: string;
  scope: string;
  message: string;
}

// Fire-and-forget: ein DB-Fehler beim Protokollieren darf nie die eigentliche
// Fehlerbehandlung des Aufrufers stoeren.
export function recordDebugEvent(scope: string, err: unknown): void {
  /*
   * Ueber fehlerText(), damit die Ursachenkette mitkommt.
   *
   * Das ist hier besonders wichtig: aus diesem Protokoll bildet die
   * Selbstheilung ihre Fehlergruppen. Stand darin bei JEDEM Netzfehler nur
   * "fetch failed", fielen DNS-Fehler, Zertifikatsfehler und Zeitlimits zu
   * EINER Gruppe zusammen — und die Reparaturkette bekam eine Gruppe von
   * dreissig Fehlern vorgelegt, die nichts miteinander zu tun hatten.
   */
  const message = fehlerText(err);
  db.insert(debugLogTable)
    .values({ scope, message })
    .catch((dbErr) => logger.warn({ dbErr }, "Debug-Log konnte nicht gespeichert werden"));
}

export async function getDebugLog(limit = 50): Promise<DebugLogEntry[]> {
  const rows = await db
    .select()
    .from(debugLogTable)
    .orderBy(desc(debugLogTable.createdAt))
    .limit(limit);
  return rows.map((r) => ({ time: r.createdAt.toISOString(), scope: r.scope, message: r.message }));
}

/*
 * Zwei Meldungen, ein Fehler.
 *
 * "Container lukas-browser-17 existiert nicht" und "Container lukas-browser-23
 * existiert nicht" sind derselbe Fehler, zweimal. Ohne diese Normalisierung
 * waeren es zwei Einzelfaelle, und genau daran scheitert jedes Zaehlen: was
 * sich haeuft, sieht man erst, wenn Gleiches auch gleich heisst.
 *
 * Weg kommt alles, was sich von Fall zu Fall unterscheidet — Zahlen, IDs,
 * UUIDs, Adressen, Pfade, Zeiten.
 */
export function fehlerSignatur(scope: string, message: string): string {
  const kern = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\/[\w./-]{6,}/g, "<pfad>")
    .replace(/\b\d[\d.,:]*\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return `${scope}::${kern}`;
}

export type Fehlergruppe = {
  signatur: string;
  scope: string;
  /** Der zuletzt gesehene Wortlaut — der geht in die Diagnose. */
  beispiel: string;
  anzahl: number;
  zuletzt: string;
};

/**
 * Die Fehler der letzten Stunden, nach Signatur zusammengefasst und nach
 * Haeufigkeit sortiert. Das ist die Grundlage dafuer, dass Lukas merkt, was
 * sich haeuft — statt jeden Eintrag einzeln zu sehen und keinen Zusammenhang.
 */
export async function fehlerGruppen(stunden = 24, ausserScopes: string[] = []): Promise<Fehlergruppe[]> {
  const seit = new Date(Date.now() - stunden * 3600 * 1000);
  const rows = await db
    .select()
    .from(debugLogTable)
    .where(gte(debugLogTable.createdAt, seit))
    .orderBy(desc(debugLogTable.createdAt))
    .limit(500);

  const gruppen = new Map<string, Fehlergruppe>();
  for (const r of rows) {
    if (ausserScopes.includes(r.scope)) continue;
    const signatur = fehlerSignatur(r.scope, r.message);
    const vorhanden = gruppen.get(signatur);
    if (vorhanden) {
      vorhanden.anzahl++;
    } else {
      gruppen.set(signatur, {
        signatur,
        scope: r.scope,
        beispiel: r.message,
        anzahl: 1,
        zuletzt: r.createdAt.toISOString(),
      });
    }
  }

  return [...gruppen.values()].sort((a, b) => b.anzahl - a.anzahl);
}
