import { bigint, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { conversations } from "./conversations";

/*
 * Datei-Anhaenge fuer den privaten Chat (Bilder, PDFs, Textdateien, Video).
 *
 * Die Datei liegt als Base64 direkt in Postgres statt in S3/auf der Platte:
 * Railway-Container haben kein persistentes Dateisystem (nach jedem Redeploy
 * waere alles weg) und ein Bucket haette zusaetzliche Zugangsdaten und
 * Einrichtung von Issa verlangt. Bei den hier geltenden Groessenlimits
 * (siehe MAX_UPLOAD_BYTES in routes/attachments.ts) ist das voellig
 * unproblematisch und kommt ohne neue Infrastruktur aus.
 *
 * messageId ist bewusst nullable: der Upload passiert, BEVOR die Nachricht
 * existiert (Issa waehlt Dateien aus und tippt dann). Beim Absenden werden die
 * Anhaenge der frisch angelegten Nachricht zugeordnet.
 */
export const attachments = pgTable("lukas_attachments", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  messageId: integer("message_id"),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertAttachmentSchema = createInsertSchema(attachments).omit({
  id: true,
  createdAt: true,
});

export type Attachment = typeof attachments.$inferSelect;
export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;
