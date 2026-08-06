import { pgTable, serial, text, integer, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const lukasStatusTable = pgTable("lukas_status", {
  id: serial("id").primaryKey(),
  mood: text("mood").notNull().default("neutral"),
  energy: text("energy").notNull().default("normal"),
  obsession: text("obsession").notNull().default("nothing specific"),
  note: text("note").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const memoriesTable = pgTable("lukas_memories", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  category: text("category").notNull().default("personal"),
  importance: integer("importance").notNull().default(5),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  embedding: jsonb("embedding").$type<number[] | null>().default(null),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const goalsTable = pgTable("lukas_goals", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("active"),
  progress: text("progress").notNull().default("just started"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const diaryTable = pgTable("lukas_diary", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  mood: text("mood").notNull().default("neutral"),
  energy: text("energy").notNull().default("normal"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const mediaJobsTable = pgTable("lukas_media_jobs", {
  id: serial("id").primaryKey(),
  requestId: text("request_id"),
  model: text("model").notNull(),
  prompt: text("prompt").notNull(),
  vision: text("vision"),
  status: text("status").notNull().default("pending"),
  resultUrl: text("result_url"),
  mediaType: text("media_type").notNull().default("image"),
  // Klartext-Grund bei status="failed". Vorher landete der Fehler nur in
  // console.error und der Job war "ohne Fehler fehlgeschlagen" — man sah nur,
  // DASS es schiefging, nie warum.
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Gefühlsarchiv: jedes emotionale Ereignis wird dauerhaft gespeichert —
// daraus entstehen aktuelle Stimmung (mit Abklingen) und langfristig Charakter.
export const emotionsTable = pgTable("lukas_emotions", {
  id: serial("id").primaryKey(),
  emotion: text("emotion").notNull(),
  valence: real("valence").notNull(), // -1 (sehr negativ) … +1 (sehr positiv)
  intensity: real("intensity").notNull(), // 0 … 1
  cause: text("cause").notNull(),
  source: text("source").notNull().default("chat"), // chat|goal|trading|media|tool|reflection|moltbook
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CharacterTraits = {
  confidence: number;
  warmth: number;
  guardedness: number;
  playfulness: number;
  ambition: number;
};

export const characterTable = pgTable("lukas_character", {
  id: serial("id").primaryKey(),
  traits: jsonb("traits").$type<CharacterTraits>().notNull(),
  selfImage: text("self_image").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Fehlerprotokoll fuer Chat/Public-Chat/Custom-LLM/TTS/Voice-Session — im
// Dashboard einsehbar (GET /api/lukas/debug-log). In der DB statt nur im
// Arbeitsspeicher, damit es Railway-Redeploys uebersteht (die bei jeder
// Variablenaenderung passieren).
export const debugLogTable = pgTable("lukas_debug_log", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMemorySchema = createInsertSchema(memoriesTable).omit({ id: true, createdAt: true });
export const insertGoalSchema = createInsertSchema(goalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDiarySchema = createInsertSchema(diaryTable).omit({ id: true, createdAt: true });
export const insertMediaJobSchema = createInsertSchema(mediaJobsTable).omit({ id: true, createdAt: true, updatedAt: true });

export const insertEmotionSchema = createInsertSchema(emotionsTable).omit({ id: true, createdAt: true });

export type EmotionRow = typeof emotionsTable.$inferSelect;
export type CharacterRow = typeof characterTable.$inferSelect;
export type Memory = typeof memoriesTable.$inferSelect;
export type Goal = typeof goalsTable.$inferSelect;
export type DiaryEntry = typeof diaryTable.$inferSelect;
export type MediaJob = typeof mediaJobsTable.$inferSelect;
export type LukasStatusRow = typeof lukasStatusTable.$inferSelect;
export type DebugLogRow = typeof debugLogTable.$inferSelect;
