/*
 * Server-Sent-Events zeilenweise lesen — aber erst, wenn eine Zeile wirklich
 * vollstaendig da ist.
 *
 * Das klingt nach Kleinkram und war der Grund, warum Lukas sporadisch gar nicht
 * geantwortet hat. Der Chat bekommt die fertige Antwort als EIN grosses
 * data:-Paket. Ein grosses Paket kommt nicht in einem Netzwerk-Happen an. Wer
 * jeden Happen fuer sich zerlegt und jede Zeile sofort durch JSON.parse jagt,
 * verliert die abgeschnittene letzte Zeile — und mit ihr die ganze Antwort.
 * Kurze Antworten passten in einen Happen und kamen an, lange nicht.
 */

export type SseSchnitt = {
  /** Zeilen, die garantiert vollstaendig sind. */
  zeilen: string[];
  /** Angefangene Zeile, die auf den naechsten Happen wartet. */
  rest: string;
};

export function takeCompleteLines(puffer: string): SseSchnitt {
  const grenze = puffer.lastIndexOf("\n");
  if (grenze < 0) return { zeilen: [], rest: puffer };
  return {
    zeilen: puffer.slice(0, grenze).split("\n"),
    rest: puffer.slice(grenze + 1),
  };
}

/** Die Nutzlast einer data:-Zeile. Alles andere (u.a. ":"-Lebenszeichen) faellt raus. */
export function parseSseData(zeile: string): Record<string, unknown> | null {
  if (!zeile.startsWith("data: ")) return null;
  try {
    const wert = JSON.parse(zeile.slice(6));
    return wert && typeof wert === "object" ? (wert as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
