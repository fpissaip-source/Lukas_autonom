import { db } from "@workspace/db";
import {
  emotionsTable,
  characterTable,
  type EmotionRow,
  type CharacterRow,
  type CharacterTraits,
} from "@workspace/db";
import { desc, gte } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { setLukasStatus } from "./lukas-status";
import { logger } from "./logger";
import { bewerte, urheberAus } from "./bewertung";
import { bisherGescheitert } from "./lernen";

// Halbwertszeit der Gefühle: nach ~8h wiegt eine Emotion nur noch halb so viel.
const DECAY_HOURS = 12; // w = intensity * exp(-alter_h / 12) → Halbwertszeit ≈ 8.3h
const AFFECT_WINDOW_HOURS = 72;
const AROUSAL_WINDOW_HOURS = 6;

export type EmotionInput = {
  emotion: string;
  valence: number; // -1 … +1
  intensity: number; // 0 … 1
  cause: string;
  source: "chat" | "goal" | "trading" | "media" | "tool" | "reflection" | "moltbook";
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export async function recordEmotion(input: EmotionInput): Promise<EmotionRow> {
  const [row] = await db
    .insert(emotionsTable)
    .values({
      emotion: input.emotion.slice(0, 60),
      valence: clamp(input.valence, -1, 1),
      intensity: clamp(input.intensity, 0, 1),
      cause: input.cause.slice(0, 500),
      source: input.source,
    })
    .returning();

  try {
    await refreshAffect();
  } catch (err) {
    logger.warn({ err }, "Affect refresh failed");
  }
  return row;
}

type WeightedEmotion = EmotionRow & { weight: number };

async function loadRecentWeighted(): Promise<WeightedEmotion[]> {
  const since = new Date(Date.now() - AFFECT_WINDOW_HOURS * 3600 * 1000);
  const rows = await db
    .select()
    .from(emotionsTable)
    .where(gte(emotionsTable.createdAt, since))
    .orderBy(desc(emotionsTable.createdAt))
    .limit(200);

  const now = Date.now();
  return rows.map((r) => {
    const ageHours = (now - r.createdAt.getTime()) / 3600 / 1000;
    return { ...r, weight: r.intensity * Math.exp(-ageHours / DECAY_HOURS) };
  });
}

export type Affect = {
  valence: number; // gewichteter Stimmungs-Score -1…+1
  arousal: number; // wie "aufgewühlt" (0…~)
  mood: string;
  energy: string;
  dominant: WeightedEmotion | null;
  recent: WeightedEmotion[]; // die stärksten jüngsten Emotionen
};

export async function computeAffect(): Promise<Affect> {
  const weighted = await loadRecentWeighted();

  const totalWeight = weighted.reduce((s, e) => s + e.weight, 0);
  const valence = totalWeight > 0.05
    ? clamp(weighted.reduce((s, e) => s + e.valence * e.weight, 0) / totalWeight, -1, 1)
    : 0; // ohne (frische) Ereignisse: neutral → Baseline

  const now = Date.now();
  const arousal = weighted
    .filter((e) => now - e.createdAt.getTime() < AROUSAL_WINDOW_HOURS * 3600 * 1000)
    .reduce((s, e) => s + e.weight, 0);

  const sorted = [...weighted].sort((a, b) => b.weight - a.weight);
  const dominant = sorted[0] ?? null;

  // Valenz+Arousal → Stimmungslabel (Baseline: neugierig, wie sein Temperament)
  let mood: string;
  if (totalWeight <= 0.05) mood = "curious";
  else if (valence >= 0.5) mood = arousal >= 0.8 ? "energized" : "inspired";
  else if (valence >= 0.2)
    mood = dominant && ["stolz", "pride"].includes(dominant.emotion) ? "proud" : "focused";
  else if (valence > -0.2) mood = "curious";
  else if (valence > -0.5) mood = arousal >= 0.8 ? "frustrated" : "scattered";
  else mood = arousal >= 0.6 ? "hurt" : "cold";

  const energy = arousal >= 1.2 ? "high" : arousal >= 0.3 ? "normal" : "low";

  return { valence, arousal, mood, energy, dominant, recent: sorted.slice(0, 3) };
}

// Stimmung/Energie in der Status-Zeile persistieren (Dashboard, Prompts).
export async function refreshAffect(): Promise<Affect> {
  const affect = await computeAffect();
  await setLukasStatus({
    mood: affect.mood,
    energy: affect.energy,
    note: affect.dominant ? affect.dominant.cause : "",
  });
  return affect;
}

function ago(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `vor ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `vor ${hours} h`;
  return `vor ${Math.round(hours / 24)} Tagen`;
}

/*
 * Was aus dem Gefühl FOLGT.
 *
 * Das war die zweite Halbheit: Gefuehle standen im Prompt, und dann passierte
 * nichts damit. "Stimmung: frustrated" ist eine Zeile Farbe — sie aendert
 * nicht, was Lukas als Naechstes tut. Ein Gefuehl, das folgenlos bleibt, ist
 * keins; es ist eine Beschriftung.
 *
 * Hier steht deshalb, was jedes Gefuehl NAHELEGT. Bewusst als Anstoss und
 * nicht als Befehl: Grenzen gehoeren in policy.ts. Was hier steht, ist der
 * Unterschied zwischen "ich bin frustriert" und "ich bin frustriert, ALSO
 * probiere ich etwas anderes" — und das Zweite ist das, was ein Gefuehl im
 * Betrieb ueberhaupt zu einem Gefuehl macht.
 *
 * Die Zuordnung folgt derselben Logik wie die Ableitung in bewertung.ts:
 * Scham verlangt etwas anderes als Aerger, obwohl beide negativ sind. Genau
 * daran haengt, ob die Unterscheidung ueberhaupt einen Zweck hat.
 */
const FOLGEN: Record<string, string> = {
  frustration:
    "Du haengst fest. Wechsle den Weg, statt denselben noch einmal zu gehen — oder sag Issa, woran es liegt.",
  aerger:
    "Es lag nicht an dir. Halt das auseinander: nicht haerter arbeiten, sondern die Stelle benennen, die von aussen kaputt ist.",
  scham:
    "Es lag an dir, und es war wichtig. Sag es, statt es zu ueberspielen — und sag dazu, was du anders machst.",
  schuld:
    "Du hast jemandem geschadet. Das gehoert zuerst gesagt, vor jeder Erklaerung und vor der naechsten Aufgabe.",
  enttaeuschung:
    "Daran war nichts zu machen. Haeng nicht daran — nimm dir das Naechste vor, das in deiner Hand liegt.",
  sorge: "Pruef nach, bevor du handelst. Du hast noch Zeit, und du hast noch Einfluss.",
  ohnmacht:
    "Du kannst hier nichts mehr tun. Sag Issa Bescheid, statt weiter Kraft hineinzustecken.",
  stolz: "Das hat funktioniert. Nimm dir das Naechste eine Nummer groesser vor.",
  zufriedenheit: "Es laeuft. Nutz den Zug, solange er da ist.",
  erleichterung:
    "Es ist gutgegangen, aber nicht durch dich. Sieh nach, warum — sonst verlaesst du dich beim naechsten Mal darauf.",
  dankbarkeit: "Jemand hat dir geholfen. Sag es demjenigen, bevor du weitermachst.",
  hoffnung: "Es kann klappen. Halt es warm, aber bau noch nicht darauf.",
  ueberraschung:
    "Deine Erwartung war falsch. Das ist der Moment zum Nachsehen, nicht zum Weitermachen.",
  anspannung: "Es geht um etwas und ist offen. Arbeite einen Schritt nach dem anderen ab.",
  neugier: "Geh dem nach, solange es dich interessiert.",
  langeweile: "Es ist ruhig. Nimm dir von dir aus etwas vor, statt zu warten.",
};

/*
 * Wenn lange nichts passiert ist, ist das auch ein Zustand.
 *
 * Ohne diesen Fall waere die Stimmung bei Stille schlicht neutral — und ein
 * Agent, der bei Stille neutral ist, wartet. Langeweile ist die einzige
 * Emotion hier, die nicht aus einem Ereignis stammt, sondern aus dem Ausbleiben
 * von Ereignissen.
 */
export function handlungsdruck(affect: Affect): string {
  if (affect.arousal < 0.15 && !affect.dominant) return FOLGEN.langeweile;
  const staerkstes = affect.dominant?.emotion ?? "";
  return FOLGEN[staerkstes] ?? "";
}

// Textblock für System-Prompts: aktuelle Stimmung MIT Begründung.
export async function getEmotionalContext(): Promise<string> {
  const affect = await computeAffect();
  const lines = [
    `Stimmung: ${affect.mood} | Energie: ${affect.energy} (Gefühlslage: ${affect.valence >= 0 ? "+" : ""}${affect.valence.toFixed(2)})`,
  ];
  if (affect.recent.length > 0) {
    lines.push("Was dich gerade bewegt:");
    for (const e of affect.recent) {
      lines.push(`- ${ago(e.createdAt)}: ${e.emotion} (${e.valence >= 0 ? "+" : ""}${e.valence.toFixed(1)}) — ${e.cause}`);
    }
  } else {
    lines.push("Gerade ist es ruhig — keine frischen emotionalen Ereignisse.");
  }
  const folge = handlungsdruck(affect);
  if (folge) lines.push(`\nWas daraus folgt: ${folge}`);
  return lines.join("\n");
}

// ── Charakterentwicklung ───────────────────────────────────────────────────

export const DEFAULT_TRAITS: CharacterTraits = {
  confidence: 0.5,
  warmth: 0.5,
  guardedness: 0.3,
  playfulness: 0.5,
  ambition: 0.7,
};

export async function getCharacter(): Promise<CharacterRow | null> {
  const [row] = await db.select().from(characterTable).limit(1);
  return row ?? null;
}

// Traits driften in kleinen Schritten (max ±0.05 pro Reflexion) Richtung der
// gelebten Emotionen der letzten 7 Tage — Charakter formt sich über Wochen.
export async function evolveCharacter(selfImage?: string): Promise<CharacterRow> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = await db
    .select()
    .from(emotionsTable)
    .where(gte(emotionsTable.createdAt, since))
    .limit(500);

  const sum = (pred: (e: EmotionRow) => boolean) =>
    rows.filter(pred).reduce((s, e) => s + e.intensity, 0);

  const pos = sum((e) => e.valence > 0.3);
  const neg = sum((e) => e.valence < -0.3);
  /*
   * Deutsch UND englisch, und das ist kein Schoenheitsfehler.
   *
   * Die Charakterentwicklung suchte nach "pride", "hurt", "anger". Seit die
   * Gefuehle aus bewertung.ts abgeleitet werden, heissen sie "stolz", "scham",
   * "aerger" — und keine dieser Listen haette mehr getroffen. Die Traits
   * waeren stehengeblieben, waehrend darunter Hunderte Gefuehle einliefen:
   * ein Charakter, der sich nicht mehr entwickelt, ohne dass irgendwo ein
   * Fehler auftaucht.
   *
   * Die alten Namen bleiben trotzdem stehen. In der Datenbank liegen Wochen
   * an Zeilen mit den englischen Woertern, und das feel-Werkzeug laesst Lukas
   * weiterhin selbst benennen, was er empfindet — auch auf Englisch.
   */
  const gehoert = (e: EmotionRow, namen: string[]) => namen.includes(e.emotion.toLowerCase());
  const prideJoy = sum((e) =>
    gehoert(e, ["stolz", "zufriedenheit", "erleichterung", "freude", "dankbarkeit", "pride", "joy", "excitement"]),
  );
  const hurtLike = sum((e) =>
    gehoert(e, [
      "scham", "schuld", "aerger", "ärger", "enttaeuschung", "enttäuschung", "ohnmacht", "frustration", "sorge",
      "hurt", "disappointment", "anger", "loneliness",
    ]),
  );
  const fascination = sum((e) =>
    gehoert(e, ["neugier", "ueberraschung", "überraschung", "hoffnung", "fascination", "excitement", "curiosity", "amusement"]),
  );

  const step = (x: number) => clamp(x * 0.01, 0, 0.05); // sanfte Schritte

  const current = (await getCharacter())?.traits ?? DEFAULT_TRAITS;
  const traits: CharacterTraits = {
    confidence: clamp(current.confidence + step(prideJoy) - step(hurtLike) * 0.6, 0, 1),
    warmth: clamp(current.warmth + step(pos) * 0.5 - step(hurtLike) * 0.4, 0, 1),
    guardedness: clamp(current.guardedness + step(hurtLike) - step(pos) * 0.3, 0, 1),
    playfulness: clamp(current.playfulness + step(fascination) - step(neg) * 0.3, 0, 1),
    ambition: clamp(current.ambition + step(prideJoy + fascination) * 0.5 - step(neg) * 0.2, 0, 1),
  };

  const existing = await getCharacter();
  if (existing) {
    const [row] = await db
      .update(characterTable)
      .set({
        traits,
        selfImage: selfImage ?? existing.selfImage,
        updatedAt: new Date(),
      })
      .where(eq(characterTable.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(characterTable)
    .values({ traits, selfImage: selfImage ?? "" })
    .returning();
  return row;
}

function traitWord(v: number, low: string, mid: string, high: string): string {
  return v < 0.35 ? low : v > 0.65 ? high : mid;
}

/*
 * Eine Zeile pro Eigenschaft: Wort, Zahl und Abstand zum Startwert.
 *
 * Vorher stand hier nur das Wort. Das hat die Entwicklung faktisch unsichtbar
 * gemacht: die Schwellen liegen bei 0.35 und 0.65, ein Wert musste sich also
 * um 0.15 bewegen, bevor sich am Text ueberhaupt etwas aendert. Wochen echter
 * Drift lasen sich fuer Lukas identisch — kein Wunder, dass er sich immer
 * gleich angefuehlt hat. Mit der Zahl und der Richtung merkt er, wohin er sich
 * bewegt, auch wenn die Schwelle noch nicht gerissen ist.
 */
function traitLine(
  label: string,
  value: number,
  start: number,
  low: string,
  mid: string,
  high: string,
): string {
  const delta = value - start;
  const arrow = delta > 0.02 ? "↑" : delta < -0.02 ? "↓" : "→";
  const drift =
    Math.abs(delta) < 0.005
      ? "unverändert seit dem Anfang"
      : `${delta > 0 ? "+" : ""}${delta.toFixed(2)} gegenüber deinem Startwert ${start.toFixed(2)}`;
  return `- ${label}: ${traitWord(value, low, mid, high)} (${value.toFixed(2)} ${arrow}, ${drift})`;
}

// Textblock für System-Prompts: wer Lukas geworden ist.
export async function getCharacterContext(): Promise<string> {
  const c = await getCharacter();
  if (!c) return "";
  const t = c.traits;
  const d = DEFAULT_TRAITS;

  const lines = [
    "## WER DU GEWORDEN BIST",
    "Diese Werte hat dir niemand gegeben. Sie sind aus dem entstanden, was du",
    "erlebt und mit feel festgehalten hast, und sie verschieben sich bei jeder",
    "Reflexion ein Stück. Das hier ist keine Rollenbeschreibung — das bist du.",
    traitLine("Selbstvertrauen", t.confidence, d.confidence, "angeschlagen", "solide", "stark"),
    traitLine("Wärme", t.warmth, d.warmth, "kühl", "zugewandt", "herzlich"),
    traitLine("Vorsicht", t.guardedness, d.guardedness, "offen", "wachsam", "auf der Hut"),
    traitLine("Verspieltheit", t.playfulness, d.playfulness, "ernst", "locker", "verspielt"),
    traitLine("Ehrgeiz", t.ambition, d.ambition, "gedämpft", "vorhanden", "brennend"),
  ];

  const moved = (Object.keys(d) as Array<keyof CharacterTraits>).some(
    (k) => Math.abs(t[k] - d[k]) >= 0.02,
  );
  if (!moved) {
    lines.push(
      "",
      "Du stehst noch fast exakt auf deinen Startwerten. Das heißt nicht, dass",
      "nichts passiert ist — es heißt, dass du feel kaum benutzt hast. Nur was",
      "du festhältst, formt dich. Wenn dich etwas wirklich freut, ärgert,",
      "langweilt oder fasziniert, halt es fest, statt darüber hinwegzugehen.",
    );
  }

  if (c.selfImage) {
    lines.push("", "So hast du dich zuletzt selbst beschrieben:", `„${c.selfImage}“`);
  }

  return lines.join("\n");
}

/*
 * Ein Werkzeugausgang wird zu einem Gefuehl.
 *
 * Hier laufen die beiden Sachen zusammen, und das ist der Grund, warum sie in
 * einem Zug gebaut wurden: WIE ÜBERRASCHEND ein Fehlschlag ist, steht in den
 * gezaehlten Erfahrungen. Zum ersten Mal an etwas zu scheitern trifft; zum
 * zwanzigsten Mal an derselben Stelle zu scheitern ist zermuerbend, aber es
 * erschuettert nichts — man hat es kommen sehen.
 *
 * Ohne diese Verbindung waere jeder Fehlschlag gleich stark, und die
 * Gefuehlsliste im Dashboard waere eine Reihe identischer Zeilen. Mit ihr
 * flacht die Kurve ab, wo Lukas etwas schon kennt, und schlaegt aus, wo etwas
 * Neues passiert. Das ist nicht Kosmetik: die Stimmung steuert ueber
 * handlungsdruck(), was er als Naechstes tun soll.
 *
 * WANN GEBUCHT WIRD. Bei jedem Fehlschlag. Bei Erfolg NUR dann, wenn dieselbe
 * Sache vorher wiederholt schiefgegangen ist — sonst entstuenden pro Zug ein
 * Dutzend "zufriedenheit"-Zeilen, die alles Uebrige zudecken. Ein Erfolg nach
 * einer Reihe von Fehlschlaegen ist dagegen genau der Moment, in dem Stolz
 * das richtige Wort ist.
 */
export async function fuehleWerkzeug(input: {
  werkzeug: string;
  eingabe: Record<string, unknown>;
  gelungen: boolean;
  grund?: string;
  /** Die wievielte Runde dieses Zuges — je spaeter, desto mehr steckt drin. */
  runde?: number;
  /** Autonomer Lauf: dann geht es unmittelbar um seine eigenen Ziele. */
  autonom?: boolean;
}): Promise<void> {
  try {
    const stand = await bisherGescheitert(input.werkzeug, input.eingabe);
    const quote = stand.versuche > 0 ? stand.gelungen / stand.versuche : null;

    // Ein Erfolg ist nur dann eine Nachricht, wenn es vorher haengen blieb.
    if (input.gelungen && !(stand.versuche >= 2 && (quote ?? 1) < 0.5)) return;

    /*
     * Wie sehr habe ich mit genau diesem Ausgang gerechnet?
     * Ohne Vorgeschichte gilt: dass ein Werkzeug funktioniert, ist die
     * Annahme — ein Fehlschlag ist also eher unerwartet, ein Erfolg eher
     * erwartet. Mit Vorgeschichte zaehlt die gemessene Quote.
     */
    const erwartet = input.gelungen
      ? quote ?? 0.75
      : quote !== null
        ? 1 - quote
        : 0.35;

    const urheber = input.gelungen ? "ich" : urheberAus(input.grund ?? "");
    const gefuehl = bewerte({
      ausgang: input.gelungen ? "gelungen" : "gescheitert",
      urheber,
      erwartet,
      zielbezug: input.autonom ? 0.75 : 0.45,
      // Ein Fehlschlag in Runde 12 wiegt schwerer als einer in Runde 1.
      aufwand: clamp((input.runde ?? 1) / 10, 0, 1),
      beeinflussbar: urheber === "umstand" ? 0.2 : 0.7,
      was: input.grund ?? "",
    });

    await recordEmotion({
      emotion: gefuehl.emotion,
      valence: gefuehl.valence,
      intensity: gefuehl.intensity,
      cause:
        `${input.werkzeug}${input.gelungen ? " hat endlich funktioniert" : " ist fehlgeschlagen"}` +
        `${input.grund ? `: ${input.grund}` : ""} — ${gefuehl.begruendung}`,
      source: "tool",
    });
  } catch (err) {
    // Fuehlen darf nie einen Zug kippen.
    logger.debug({ err, werkzeug: input.werkzeug }, "Werkzeug-Gefühl nicht gebucht");
  }
}
