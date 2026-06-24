import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMemorySchema = createInsertSchema(memoriesTable).omit({ id: true, createdAt: true });
export const insertGoalSchema = createInsertSchema(goalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDiarySchema = createInsertSchema(diaryTable).omit({ id: true, createdAt: true });
export const insertMediaJobSchema = createInsertSchema(mediaJobsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type Memory = typeof memoriesTable.$inferSelect;
export type Goal = typeof goalsTable.$inferSelect;
export type DiaryEntry = typeof diaryTable.$inferSelect;
export type MediaJob = typeof mediaJobsTable.$inferSelect;
export type LukasStatusRow = typeof lukasStatusTable.$inferSelect;
