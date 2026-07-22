// Eigener, kleiner Fehlerspeicher fuer die oeffentlichen/kritischen Routen —
// im Dashboard einsehbar (GET /api/lukas/debug-log), damit Fehlerursachen
// (z.B. beim ElevenLabs Custom-LLM-Test) ohne Railway-Log-Zugriff sichtbar sind.
// Bewusst nur In-Memory (kein DB-Schreibzugriff im Fehlerfall noetig) und mit
// fixem Limit, damit es kein Speicherleck werden kann.

export interface DebugLogEntry {
  time: string;
  scope: string;
  message: string;
}

const MAX_ENTRIES = 50;
const buffer: DebugLogEntry[] = [];

export function recordDebugEvent(scope: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  buffer.unshift({ time: new Date().toISOString(), scope, message });
  if (buffer.length > MAX_ENTRIES) buffer.length = MAX_ENTRIES;
}

export function getDebugLog(): DebugLogEntry[] {
  return buffer;
}
