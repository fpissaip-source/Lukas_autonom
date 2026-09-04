/*
 * Die Grenze zwischen dem stabilen und dem wechselnden Teil des
 * System-Prompts.
 *
 * WOFUER: Anthropic vergleicht Praefixe nur an gesetzten Cache-Marken. Steht
 * genau eine am Ende des ganzen System-Prompts, dann ist der gespeicherte
 * Block alles — einschliesslich Gefuehlszustand, Erinnerungen und Budget, die
 * sich zwischen zwei Nachrichten aendern. Der Treffer faellt damit bei jeder
 * neuen Nachricht aus, obwohl die ersten rund 11.600 Token byte-gleich sind.
 *
 * EIGENE DATEI OHNE ABHAENGIGKEITEN, und das ist kein Ordnungsfimmel: die
 * Marke wird in system-prompt.ts gesetzt und in model-client.ts gelesen.
 * Wuerde model-client die Konstante aus system-prompt importieren, zoege es
 * darueber die Datenbank in einen Pfad, der sie nicht braucht — und genau das
 * hat hier schon einmal zwei Pruefungen zerlegt, weil sie den Modellpfad
 * schlank buendeln.
 *
 * Der Wert ist bewusst eine Zeile, die in einem echten Prompt nicht vorkommt.
 * Bleibt sie versehentlich stehen, sieht man es sofort statt nie.
 */
export const CACHE_TRENNER = "<<<LUKAS_CACHE_TRENNER>>>";

/** Entfernt die Marke — fuer jeden Weg, der den Prompt als EINEN Text braucht. */
export function ohneTrenner(text: string): string {
  return text.includes(CACHE_TRENNER) ? text.split(CACHE_TRENNER).join("\n") : text;
}

export type SystemBlock = {
  type: "text";
  text: string;
  cache_control: { type: "ephemeral" };
};

/**
 * Den System-Prompt in die Bloecke zerlegen, die Anthropic bekommt.
 *
 * DIE EIGENSCHAFT, AUF DIE ES ANKOMMT: zwei Prompts, die sich nur hinter der
 * Marke unterscheiden, muessen einen BYTE-GLEICHEN ersten Block ergeben. Nur
 * dann findet Anthropic beim naechsten Mal den Praefix wieder. Alles andere
 * hier — die Zahl der Bloecke, die Reihenfolge — folgt daraus.
 *
 * Ohne Marke bleibt es bei EINEM Block mit einer Marke. Das ist das alte
 * Verhalten und fuer kurze Prompts (Untermitarbeiter, oeffentliches Widget)
 * auch das richtige: dort gibt es keinen stabilen Teil, den zu trennen sich
 * lohnte.
 *
 * Leere Bloecke entstehen nie — Anthropic lehnt sie ab, und ein Prompt, der
 * genau auf der Marke endet, ist ein voellig normaler Fall.
 */
export function systemBloecke(system: string): SystemBlock[] {
  const marke = { type: "ephemeral" } as const;
  if (!system.includes(CACHE_TRENNER)) {
    return [{ type: "text", text: system, cache_control: marke }];
  }

  const [stabil, ...rest] = system.split(CACHE_TRENNER);
  const wechselnd = rest.join("\n");

  if (!stabil.trim()) {
    return [{ type: "text", text: wechselnd, cache_control: marke }];
  }

  const bloecke: SystemBlock[] = [{ type: "text", text: stabil, cache_control: marke }];
  if (wechselnd.trim()) {
    bloecke.push({ type: "text", text: wechselnd, cache_control: marke });
  }
  return bloecke;
}
