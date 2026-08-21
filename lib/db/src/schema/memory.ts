import { pgTable, serial, text, integer, real, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Vier-Schichten-Gedächtnis: Postgres ist die Wahrheitsquelle ────────────
// Obsidian-Vault und Graphify sind nur generierte Sichten darauf.

// Andere Agenten, die Lukas kennt (v.a. von Moltbook) — semantisches Gedächtnis
export const knownAgentsTable = pgTable("lukas_known_agents", {
  id: serial("id").primaryKey(),
  handle: text("handle").notNull(),
  platform: text("platform").notNull().default("moltbook"),
  firstSeen: timestamp("first_seen").defaultNow().notNull(),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  trustScore: real("trust_score").notNull().default(0.5), // 0..1
  relationshipStrength: real("relationship_strength").notNull().default(0.1), // 0..1
  topics: jsonb("topics").$type<string[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
});

// Episodisches Gedächtnis: was ist wann konkret passiert (unveränderlich)
export const episodesTable = pgTable("lukas_episodes", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // moltbook_session | chat | reflection | trading
  summary: text("summary").notNull().default(""),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
});

// Semantisches Gedächtnis: Aussagen mit Quelle, Vertrauen und Evidenz-Stufe.
// Evidenz: 0=eigener Gedanke, 1=eigene Beobachtung, 2=fremde Behauptung,
//          3=mehrfach gestützt, 4=technisch/empirisch verifiziert
export const claimsTable = pgTable("lukas_claims", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull(),
  predicate: text("predicate").notNull(),
  value: text("value").notNull(),
  confidence: real("confidence").notNull().default(0.35), // 0..1
  evidenceLevel: integer("evidence_level").notNull().default(2),
  sourceType: text("source_type").notNull().default("unknown"),
  sourceId: text("source_id"),
  observedAt: timestamp("observed_at").defaultNow().notNull(),
  lastVerifiedAt: timestamp("last_verified_at"),
  status: text("status").notNull().default("unverified"), // unverified|corroborated|verified|contradicted|retracted
  episodeId: integer("episode_id"),
  corroborations: integer("corroborations").notNull().default(1),
  embedding: jsonb("embedding").$type<number[] | null>().default(null),
}, (t) => [
  /*
   * Der Graph-Einstieg sucht Entitaeten auf beiden Seiten einer Aussage.
   *
   * Die Subjektseite ist eine normale Spalte. Die Wertseite muss erst
   * normalisiert werden ("Hareb Digital" -> "hareb_digital") — ohne
   * Ausdrucksindex wuerde genau dieser Vergleich die Tabelle Zeile fuer Zeile
   * durchgehen und den Sinn der gezielten Suche wieder auffressen.
   */
  index("lukas_claims_subject_idx").on(t.subject),
  index("lukas_claims_wert_idx").on(
    sql`lower(regexp_replace(btrim(${t.value}), '\\s+', '_', 'g'))`,
  ),
  index("lukas_claims_episode_idx").on(t.episodeId),
]);

export type ActionOutcome = {
  responseReceived?: boolean;
  responseDelayMinutes?: number;
  engagementScore?: number;
  informationGain?: number;
  notes?: string;
};

// Aktionen + Resultate — Grundlage für Lernen aus Erfahrung
export const memActionsTable = pgTable("lukas_actions", {
  id: serial("id").primaryKey(),
  episodeId: integer("episode_id"),
  type: text("type").notNull(), // comment | post | reply | upvote
  strategy: text("strategy"),
  target: text("target"), // z.B. Moltbook post_id oder Agent-Handle
  contentExcerpt: text("content_excerpt").notNull().default(""),
  outcome: jsonb("outcome").$type<ActionOutcome | null>().default(null),
  outcomeAt: timestamp("outcome_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Prozedurales Gedächtnis: erlernte Strategien mit gemessenem Erfolg
export const strategiesTable = pgTable("lukas_strategies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rule: text("rule").notNull().default(""),
  successScore: real("success_score").notNull().default(0.5), // 0..1
  sampleSize: integer("sample_size").notNull().default(0),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type KnownAgent = typeof knownAgentsTable.$inferSelect;
export type Episode = typeof episodesTable.$inferSelect;
export type Claim = typeof claimsTable.$inferSelect;
export type MemAction = typeof memActionsTable.$inferSelect;
export type Strategy = typeof strategiesTable.$inferSelect;
