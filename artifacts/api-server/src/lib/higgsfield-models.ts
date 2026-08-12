/*
 * Welches Higgsfield-Modell nimmt Lukas?
 *
 * Das Studio kannte bisher nur drei fest eingetippte Modellnamen im alten
 * REST-Format ("higgsfield-ai/soul/standard", "bytedance/seedance/v1/pro/
 * image-to-video", "kling-video/v2.1/pro/image-to-video"). Ueber MCP heissen
 * die Modelle anders — dort gibt es einen Katalog mit kurzen IDs. Die alten
 * Pfade sind darin schlicht unbekannt, weshalb jede Generierung ueber MCP an
 * einem Modellnamen scheiterte, den es nicht gibt.
 *
 * Zweiter Punkt, den Issa angesprochen hat: Seedance 2.5. Das ist im Katalog
 * das Standardmodell fuer Text-zu-Video — Lukas konnte es bisher gar nicht
 * waehlen, weil es in seiner Liste nicht vorkam.
 *
 * Diese Datei ist die eine Stelle, an der die Katalog-IDs stehen: einmal fuer
 * das Prompt (damit Lukas ueberhaupt weiss, was zur Auswahl steht) und einmal
 * fuer die Uebersetzung alter Namen, damit gespeicherte Auftraege und
 * Bestandscode nicht ins Leere laufen.
 */

export type HiggsfieldMediaType = "image" | "video";

/** Modelle aus dem MCP-Katalog, mit dem wofuer-Satz aus der Server-Beschreibung. */
export const HIGGSFIELD_MODELS: Record<
  HiggsfieldMediaType,
  Array<{ id: string; wofuer: string }>
> = {
  image: [
    { id: "soul_2", wofuer: "Portraits, Fashion, UGC, Editorial, Charakter-Referenzen" },
    { id: "nano_banana_pro", wofuer: "4K, Bilder mit Text darin, Diagramme" },
    { id: "marketing_studio_image", wofuer: "Werbung, Produktbilder, Commercial" },
    { id: "soul_cast", wofuer: "Charakter/Avatar rein aus Text" },
  ],
  video: [
    { id: "seedance_2_5", wofuer: "Standard fuer Text-zu-Video und Referenz-Konsistenz" },
    { id: "kling3_0", wofuer: "mehrere Einstellungen, Ton, Motion Transfer" },
    { id: "minimax_h3", wofuer: "2K, Keyframes, Bild-/Video-/Audio-Referenzen" },
    { id: "marketing_studio_video", wofuer: "Werbung und Produktvideos" },
  ],
};

export const HIGGSFIELD_DEFAULT: Record<HiggsfieldMediaType, string> = {
  image: "soul_2",
  video: "seedance_2_5",
};

function known(mediaType: HiggsfieldMediaType, id: string): boolean {
  return HIGGSFIELD_MODELS[mediaType].some((m) => m.id === id);
}

/**
 * Einen Modellnamen auf eine gueltige Katalog-ID bringen.
 *
 * Bekannte ID -> unveraendert. Alter REST-Pfad -> uebersetzt. Alles andere ->
 * der Standard fuer diesen Medientyp, denn ein erfundener Name ist im Studio
 * nur ein Fehlschlag mit Umweg.
 */
export function resolveHiggsfieldModel(
  mediaType: HiggsfieldMediaType,
  model: string | null | undefined,
): string {
  const raw = (model ?? "").trim();
  if (!raw) return HIGGSFIELD_DEFAULT[mediaType];
  if (known(mediaType, raw)) return raw;

  const lower = raw.toLowerCase();
  if (lower.includes("seedance")) return "seedance_2_5";
  if (lower.includes("kling")) return "kling3_0";
  if (lower.includes("minimax") || lower.includes("hailuo")) return "minimax_h3";
  if (lower.includes("marketing")) {
    return mediaType === "video" ? "marketing_studio_video" : "marketing_studio_image";
  }
  if (lower.includes("nano") || lower.includes("banana")) return "nano_banana_pro";
  if (lower.includes("soul")) return mediaType === "video" ? "seedance_2_5" : "soul_2";

  return HIGGSFIELD_DEFAULT[mediaType];
}

/**
 * Bild oder Video? Die alten Namen trugen das im Pfad ("image-to-video"), die
 * Katalog-IDs nicht — deshalb wird beides beruecksichtigt.
 */
export function higgsfieldMediaType(model: string | null | undefined): HiggsfieldMediaType {
  const lower = (model ?? "").toLowerCase();
  if (known("video", lower)) return "video";
  if (known("image", lower)) return "image";
  return lower.includes("video") ? "video" : "image";
}

/** Die Modell-Liste als Text fuers Prompt — eine Quelle, keine zweite Liste. */
export function modelHinweisFuerPrompt(): string {
  const zeile = (t: HiggsfieldMediaType) =>
    HIGGSFIELD_MODELS[t].map((m) => `  - ${m.id}: ${m.wofuer}`).join("\n");
  return `BILD-MODELLE:\n${zeile("image")}\n\nVIDEO-MODELLE:\n${zeile("video")}`;
}
