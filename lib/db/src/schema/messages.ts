import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { conversations } from "./conversations";

/**
 * Ein Arbeitsschritt hinter einer Antwort: welches Werkzeug, womit, was kam
 * zurueck.
 *
 * Im Chat lief das bisher nur als "[⚙ execute_command]" durch und war nach dem
 * Neuladen weg. Issa will sehen, was Lukas tatsaechlich getan hat — welchen
 * Befehl er abgesetzt hat, was er einen Subagenten gefragt hat und was der
 * geantwortet hat. Dafuer muss es die Seite ueberleben, also steht es an der
 * Nachricht.
 */
export type ToolStep = {
  tool: string;
  /** Argumente, gekuerzt. */
  input: string;
  /** Ergebnis, gekuerzt. */
  result: string;
  ok: boolean;
  /** Dauer in Millisekunden. */
  ms: number;
};

export const messages = pgTable("lukas_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  steps: jsonb("steps").$type<ToolStep[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
  steps: true,
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
