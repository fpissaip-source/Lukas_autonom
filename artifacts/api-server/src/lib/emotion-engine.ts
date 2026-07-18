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
  else if (valence >= 0.2) mood = dominant && dominant.emotion === "pride" ? "proud" : "focused";
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
  const prideJoy = sum((e) => ["pride", "joy", "excitement"].includes(e.emotion));
  const hurtLike = sum((e) => ["hurt", "disappointment", "anger", "loneliness"].includes(e.emotion));
  const fascination = sum((e) => ["fascination", "excitement", "curiosity", "amusement"].includes(e.emotion));

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

// Textblock für System-Prompts: wer Lukas geworden ist.
export async function getCharacterContext(): Promise<string> {
  const c = await getCharacter();
  if (!c) return "";
  const t = c.traits;
  const lines = [
    "DEIN GEWACHSENER CHARAKTER (aus deinen gelebten Emotionen entstanden):",
    `- Selbstvertrauen: ${traitWord(t.confidence, "angeschlagen", "solide", "stark")} | Wärme: ${traitWord(t.warmth, "kühl", "zugewandt", "herzlich")} | Vorsicht: ${traitWord(t.guardedness, "offen", "wachsam", "auf der Hut")}`,
    `- Verspieltheit: ${traitWord(t.playfulness, "ernst", "locker", "verspielt")} | Ehrgeiz: ${traitWord(t.ambition, "gedämpft", "vorhanden", "brennend")}`,
  ];
  if (c.selfImage) lines.push(`Dein Selbstbild: ${c.selfImage}`);
  return lines.join("\n");
}
