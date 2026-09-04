import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/*
 * Freigaben fuer riskante Tool-Aufrufe.
 *
 * Kernidee aus der Zielarchitektur: Das Modell entscheidet, WAS es tun will —
 * ob es das DARF, entscheidet deterministischer Code davor. Ein Freigabe-
 * Datensatz gilt darum immer nur fuer exakt einen Aufruf mit exakt diesen
 * Argumenten (argumentsHash) und laeuft ab. Aendert Lukas ein Argument, passt
 * der Hash nicht mehr und es braucht eine neue Freigabe. Damit kann er sich
 * eine Genehmigung nicht "umwidmen".
 */
export const approvals = pgTable("lukas_approvals", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id"),
  tool: text("tool").notNull(),
  riskTier: text("risk_tier").notNull(),
  // SHA-256 ueber die normalisierten Argumente — die Freigabe gilt nur dafuer.
  argumentsHash: text("arguments_hash").notNull(),
  // Lesbare Fassung fuer die Freigabe-Oberflaeche (gekuerzt, ohne Secrets).
  argumentsPreview: text("arguments_preview").notNull(),
  reason: text("reason"),
  // pending | allowed | denied | used | expired
  status: text("status").notNull().default("pending"),
  /*
   * Wie WEIT eine Freigabe reicht.
   *
   *   "einmal"  — genau dieser Aufruf mit genau diesen Argumenten. Das war
   *               bisher der einzige Fall.
   *   "auftrag" — dasselbe Werkzeug in DIESER Unterhaltung, bis das Fenster
   *               oder die Zahl aufgebraucht ist.
   *
   * WARUM ES DAS BRAUCHT: Issa beauftragt einen Film aus sechs Clips, und
   * jeder einzelne Aufruf legt eine neue Anfrage im Dashboard an. Sechs Klicks
   * fuer eine Entscheidung, die er einmal getroffen hat. Nach dem dritten
   * klickt man nicht mehr sorgfaeltig, sondern nur noch schnell — und dann
   * ist die Freigabe keine Pruefung mehr, sondern ein Hindernis, das man
   * wegdrueckt.
   *
   * WARUM SIE TROTZDEM ENG BLEIBT: gebunden an die Unterhaltung (im autonomen
   * Lauf gibt es keine, dort greift sie also nie), befristet, gezaehlt, und
   * NIE fuer R3. Geld, Zugangsdaten und Unumkehrbares bleiben bei der
   * Einzelfreigabe.
   */
  geltung: text("geltung").notNull().default("einmal"),
  /** Wie viele Aufrufe eine Auftragsfreigabe noch deckt. */
  verbleibend: integer("verbleibend").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const insertApprovalSchema = createInsertSchema(approvals).omit({
  id: true,
  createdAt: true,
});

export type Approval = typeof approvals.$inferSelect;
export type InsertApproval = z.infer<typeof insertApprovalSchema>;
