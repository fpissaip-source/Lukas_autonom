import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/*
 * Code-Vorschlaege von Lukas.
 *
 * Bewusst KEIN Branch und kein Pull Request: Issa will nicht fuer jede
 * Kleinigkeit auf GitHub wechseln. Der Vorschlag liegt im Dashboard, in
 * verstaendlicher Sprache, und wird dort entschieden.
 *
 * Drei Wege raus:
 *   accepted   -> die Aenderung wird geschrieben (Commit auf den Zielbranch)
 *   rejected   -> erledigt, Lukas erfaehrt es
 *   revision   -> geht mit Issas Kommentar zurueck an Lukas
 *
 * Der Datensatz bleibt in jedem Fall erhalten. Damit ist auch spaeter noch
 * nachvollziehbar, was Lukas wann an sich selbst aendern wollte und warum —
 * bei einem System, das sich selbst umschreibt, ist genau das die wichtigste
 * Spur.
 */
export type ProposalFile = {
  path: string;
  content: string;
};

export const codeProposals = pgTable("lukas_code_proposals", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id"),
  repo: text("repo").notNull(),
  title: text("title").notNull(),
  // In normaler Sprache: was passiert, wenn Issa das annimmt. Ohne Fachbegriffe.
  summary: text("summary").notNull(),
  // Warum Lukas das vorschlaegt — welches Problem er geloest hat.
  reasoning: text("reasoning").notNull().default(""),
  // [{ path, content }] — content ist immer der VOLLSTAENDIGE neue Dateiinhalt.
  files: jsonb("files").$type<ProposalFile[]>().notNull(),
  // pending | accepted | rejected | revision
  status: text("status").notNull().default("pending"),
  // Issas Kommentar beim Zurueckschicken (oder beim Ablehnen).
  comment: text("comment"),
  // Ergebnis des Anwendens: Commit-Link oder Fehlermeldung.
  appliedResult: text("applied_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const insertCodeProposalSchema = createInsertSchema(codeProposals).omit({
  id: true,
  createdAt: true,
});

export type CodeProposal = typeof codeProposals.$inferSelect;
export type InsertCodeProposal = z.infer<typeof insertCodeProposalSchema>;
