/*
 * Die Zwischenablage fuer Bilder, die Lukas' Werkzeuge nebenbei erzeugen.
 *
 * Eigenes Modul, nicht als Anhaengsel in lukas-tools: hier haengt nichts an
 * Datenbank, MCP oder SSH, und genau deshalb laesst sich die Ablage in einer
 * Pruefung ohne eine einzige Attrappe bewegen. Alles, was hier passiert, ist
 * fuer sich pruefbar — die Werkzeugschicht darueber ist es nicht.
 */
import type OpenAI from "openai";

/*
 * Bilder, die ein Werkzeug nebenbei erzeugt hat.
 *
 * executeLukasTool gibt einen String zurueck — und dabei bleibt es, weil an
 * dieser Signatur zwei Schleifen und ein Dutzend Aufrufer haengen. Ein
 * Bildschirmfoto ist aber kein String. Es liegt deshalb hier zwischen, bis die
 * Schleife nach der Werkzeugrunde einmal abraeumt und daraus eine echte
 * Bildnachricht macht.
 *
 * Warum ueberhaupt: der Text einer Seite sagt nicht, ob der Knopf sichtbar
 * war, ob ein Cookie-Banner davorliegt oder ob nach dem Absenden etwas Rotes
 * dasteht. Lukas soll die Seite sehen wie ein Mensch, nicht ihren DOM lesen.
 *
 * Zwei Grenzen, beide absichtlich:
 *  - hoechstens ZWEI Bilder pro Runde. Jedes kostet rund 2.500 Tokens; wer in
 *    einer Runde zehnmal klickt, wuerde sonst allein mit Bildern das
 *    Zugbudget sprengen. Behalten wird das JUENGSTE — der letzte Zustand ist
 *    der, auf dem der naechste Schritt aufbaut.
 *  - alles aelter als fuenf Minuten fliegt raus. Holt eine Schleife die Bilder
 *    nie ab (Abbruch, Fehler, Verbindung weg), waechst die Ablage sonst
 *    unbegrenzt weiter — in einem Prozess, der wochenlang laeuft.
 */
type GemerktesBild = { quelle: string; datenUrl: string; wann: number };
const bildAblage = new Map<number, GemerktesBild[]>();
const BILD_HALTBARKEIT_MS = 5 * 60 * 1000;
const BILDER_PRO_RUNDE = 2;

export function merkeBild(conversationId: number | undefined, quelle: string, base64: string): void {
  if (conversationId === undefined || !base64) return;
  const jetzt = Date.now();
  for (const [id, liste] of bildAblage) {
    const frisch = liste.filter((b) => jetzt - b.wann < BILD_HALTBARKEIT_MS);
    if (frisch.length) bildAblage.set(id, frisch);
    else bildAblage.delete(id);
  }
  const liste = bildAblage.get(conversationId) ?? [];
  liste.push({ quelle, datenUrl: `data:image/jpeg;base64,${base64}`, wann: jetzt });
  bildAblage.set(conversationId, liste.slice(-BILDER_PRO_RUNDE));
}

/*
 * Die Marke, an der eine Bildnachricht als "von einem Werkzeug" erkennbar ist.
 * Ohne sie liesse sich beim Aufraeumen nicht unterscheiden, was Lukas selbst
 * beim Klicken erzeugt hat und was Issa angehaengt hat — und Issas Foto beim
 * dritten Klick stillschweigend wegzuwerfen waere schlicht ein Fehler.
 */
export const BILD_MARKE = "\u2009[Werkzeugbild]";

/*
 * Alte Bildschirmfotos entwerten, bevor ein neues dazukommt.
 *
 * Jedes Bild kostet rund 2.500 Tokens und bleibt sonst bis zum Ende des Zuges
 * im Verlauf stehen. Zehn Klicks waeren 25.000 Tokens — fuer neun Ansichten
 * einer Seite, die es so nicht mehr gibt. Das JUENGSTE Bild zeigt den Zustand,
 * auf dem der naechste Schritt aufbaut; die aelteren sind Geschichte.
 *
 * Entfernt wird nur das Bild, nicht die Nachricht: die Zeile bleibt als Text
 * stehen, damit im Verlauf sichtbar bleibt, dass er dort hingesehen hat.
 */
export function entwerteAlteBilder(
  convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): void {
  for (const nachricht of convo as any[]) {
    if (nachricht?.role !== "user" || !Array.isArray(nachricht.content)) continue;
    const teile = nachricht.content as any[];
    const unseres = teile.some((t) => t?.type === "text" && String(t.text).includes(BILD_MARKE));
    if (!unseres || !teile.some((t) => t?.type === "image_url")) continue;
    nachricht.content = teile
      .filter((t) => t?.type !== "image_url")
      .map((t) =>
        t?.type === "text"
          ? { ...t, text: `${String(t.text)} (Bild entfernt — inzwischen überholt.)` }
          : t,
      );
  }
}

export function nimmBilder(conversationId: number | undefined): { quelle: string; datenUrl: string }[] {
  if (conversationId === undefined) return [];
  const liste = bildAblage.get(conversationId);
  if (!liste?.length) return [];
  bildAblage.delete(conversationId);
  return liste.map(({ quelle, datenUrl }) => ({ quelle, datenUrl }));
}
