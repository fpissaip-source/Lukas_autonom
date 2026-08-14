import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/*
 * Lukas' eigene Mitarbeiter.
 *
 * Die sechs Rollen im Code sind die Grundausstattung. Was hier steht, hat Lukas
 * selbst angelegt — und das ist der Punkt: ein Team, das er sich nur fuer einen
 * Zug ausdenkt und danach vergisst, ist kein Team. Merkt er, dass er staendig
 * dieselbe Art Auftrag hat, soll er dafuer einen Mitarbeiter einstellen und ihn
 * beim naechsten Mal wieder rufen koennen.
 *
 * `tools` sind die Namen der Werkzeuge, die dieser Mitarbeiter benutzen darf.
 * Was nicht drinsteht, hat er nicht — das ist der ganze Unterschied zwischen
 * einer Rolle und einem zweiten Lukas.
 */
export const subagentsTable = pgTable("lukas_subagents", {
  id: serial("id").primaryKey(),
  /** Kurzname zum Rufen, klein und ohne Leerzeichen. */
  slug: text("slug").notNull().unique(),
  /** Wie er im Gutachten genannt wird. */
  name: text("name").notNull(),
  /** Sein Auftrag — was er tut und wie er antwortet. */
  prompt: text("prompt").notNull(),
  tools: jsonb("tools").$type<string[]>().notNull().default([]),
  /** Wozu Lukas ihn eingestellt hat. Fuer die Liste, die er sich ansieht. */
  zweck: text("zweck"),
  einsaetze: integer("einsaetze").notNull().default(0),
  zuletztGenutzt: timestamp("zuletzt_genutzt", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertSubagentSchema = createInsertSchema(subagentsTable).omit({
  id: true,
  createdAt: true,
  einsaetze: true,
  zuletztGenutzt: true,
});

export type Subagent = typeof subagentsTable.$inferSelect;
export type InsertSubagent = z.infer<typeof insertSubagentSchema>;
