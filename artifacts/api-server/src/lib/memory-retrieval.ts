/*
 * Memory-Retrieval — bewertete Erinnerungssuche über Memories, Claims und
 * Episoden.
 *
 * Score = Relevanz × Vertrauen × Wichtigkeit × Aktualität × Quellenqualität.
 * Ein spektakulärer unbelegter Claim wiegt damit weniger als mehrfach
 * bestätigtes Wissen.
 *
 * Semantik: optional Voyage-Embeddings (VOYAGE_API_KEY, voyage-3.5-lite),
 * als jsonb gespeichert, Kosinus in JS — bewusst ohne pgvector-Zwang; bei
 * unserer Größenordnung (Hunderte Zeilen) völlig ausreichend. Ohne Key:
 * rein lexikalische Relevanz (Wortüberlappung + ILIKE-Vorfilter).
 */
import { db } from "@workspace/db";
import { memoriesTable, claimsTable, episodesTable, type Claim } from "@workspace/db";
import { desc, eq, isNull } from "drizzle-orm";
import { formatClaim } from "./memory-writer";
import { logger } from "./logger";

const VOYAGE_MODEL = "voyage-3.5-lite";

export type MemoryHit = {
  kind: "memory" | "claim" | "episode";
  id: number;
  text: string;
  score: number;
};

// ── Embeddings (optional) ──────────────────────────────────────────────────

async function embed(texts: string[]): Promise<number[][] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key || texts.length === 0) return null;
  try {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: texts.slice(0, 128) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Voyage-Embedding fehlgeschlagen");
      return null;
    }
    const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    return data.data?.map((d) => d.embedding) ?? null;
  } catch (err) {
    logger.warn({ err }, "Voyage-Embedding Fehler");
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Lexikalische Relevanz: Anteil der Query-Wörter, die im Text vorkommen
function lexicalRelevance(query: string, text: string): number {
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  if (words.length === 0) return 0;
  const t = text.toLowerCase();
  const hits = words.filter((w) => t.includes(w)).length;
  return hits / words.length;
}

// Neue Zeilen nachträglich einbetten (lazy backfill, wird von der
// Konsolidierung aufgerufen; ohne Key ein No-Op)
export async function embedNewRows(): Promise<number> {
  if (!process.env.VOYAGE_API_KEY) return 0;
  let count = 0;

  const newMemories = await db.select().from(memoriesTable).where(isNull(memoriesTable.embedding)).limit(64);
  if (newMemories.length > 0) {
    const vecs = await embed(newMemories.map((m) => m.content));
    if (vecs) {
      for (let i = 0; i < newMemories.length && i < vecs.length; i++) {
        await db.update(memoriesTable).set({ embedding: vecs[i] }).where(eq(memoriesTable.id, newMemories[i].id));
        count++;
      }
    }
  }

  const newClaims = await db.select().from(claimsTable).where(isNull(claimsTable.embedding)).limit(64);
  if (newClaims.length > 0) {
    const vecs = await embed(newClaims.map((c) => `${c.subject} ${c.predicate} ${c.value}`));
    if (vecs) {
      for (let i = 0; i < newClaims.length && i < vecs.length; i++) {
        await db.update(claimsTable).set({ embedding: vecs[i] }).where(eq(claimsTable.id, newClaims[i].id));
        count++;
      }
    }
  }
  return count;
}

// ── Scoring ────────────────────────────────────────────────────────────────

const recency = (d: Date) => Math.exp(-((Date.now() - d.getTime()) / 86400000) / 30); // Halbwert ~21 Tage

function claimSourceFactor(c: Claim): number {
  switch (c.status) {
    case "verified": return 1.0;
    case "corroborated": return 0.9;
    case "contradicted": return 0.2;
    case "retracted": return 0.1;
    default: return 0.6;
  }
}

// ── Suche ──────────────────────────────────────────────────────────────────

export async function searchMemory(query: string, limit = 8): Promise<MemoryHit[]> {
  const q = query.trim();
  if (!q) return [];

  // Kandidaten laden (kleine Tabellen → großzügig, Score entscheidet)
  const [memories, claims, episodes] = await Promise.all([
    db.select().from(memoriesTable).orderBy(desc(memoriesTable.createdAt)).limit(300),
    db.select().from(claimsTable).orderBy(desc(claimsTable.observedAt)).limit(300),
    db.select().from(episodesTable).orderBy(desc(episodesTable.startedAt)).limit(150),
  ]);

  const queryVec = (await embed([q]))?.[0] ?? null;

  const relevance = (text: string, vec: number[] | null): number => {
    const lex = lexicalRelevance(q, text);
    if (queryVec && vec) {
      const sem = Math.max(0, cosine(queryVec, vec));
      return Math.max(lex, sem); // bester der beiden Kanäle
    }
    return lex;
  };

  const hits: MemoryHit[] = [];

  for (const m of memories) {
    const rel = relevance(m.content, m.embedding);
    if (rel <= 0.05) continue;
    hits.push({
      kind: "memory",
      id: m.id,
      text: `[Erinnerung|${m.category}] ${m.content}`,
      score: rel * 0.9 * (m.importance / 10) * Math.max(0.3, recency(m.createdAt)),
    });
  }

  for (const c of claims) {
    const rel = relevance(`${c.subject} ${c.predicate} ${c.value}`, c.embedding);
    if (rel <= 0.05) continue;
    hits.push({
      kind: "claim",
      id: c.id,
      text: `[Wissen] ${formatClaim(c)}`,
      score: rel * (0.5 + c.confidence / 2) * claimSourceFactor(c) * Math.max(0.3, recency(c.observedAt)),
    });
  }

  for (const e of episodes) {
    const text = `${e.kind}: ${e.summary}`;
    const rel = relevance(text, null);
    if (rel <= 0.05 || !e.summary) continue;
    hits.push({
      kind: "episode",
      id: e.id,
      text: `[Episode ${e.startedAt.toISOString().slice(0, 10)}] ${text}`,
      score: rel * 0.7 * Math.max(0.2, recency(e.startedAt)),
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Formatierter Block für System-Prompts / das query_memory-Tool
export async function memoryContextFor(query: string, limit = 6): Promise<string> {
  const hits = await searchMemory(query, limit);
  if (hits.length === 0) return "";
  return hits.map((h) => `- ${h.text}`).join("\n");
}
