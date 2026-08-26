import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

/*
 * Verschickte und empfangene Kurznachrichten.
 *
 * Warum ueberhaupt eine Tabelle: eine SMS ist raus, sobald sie raus ist. Ohne
 * Protokoll weiss hinterher niemand, was an wen ging — weder Issa noch Lukas.
 * Und Lukas soll sich beim naechsten Mal daran erinnern koennen, dass er dieser
 * Nummer schon geschrieben hat.
 *
 * `quelle` trennt die beiden Wege bewusst: aus dem Dashboard hat Issa selbst
 * getippt, "lukas" heisst, er hat es formuliert. Das ist im Nachhinein der
 * wichtigste Unterschied.
 */
export const smsNachrichten = pgTable(
  "lukas_sms",
  {
    id: serial("id").primaryKey(),
    /** raus | rein */
    richtung: text("richtung").notNull().default("raus"),
    nummer: text("nummer").notNull(),
    text: text("text").notNull(),
    /** dashboard | lukas | antwort */
    quelle: text("quelle").notNull().default("dashboard"),
    /** Was ClickSend gemeldet hat: SUCCESS, QUEUED, INVALID_RECIPIENT … */
    status: text("status").notNull().default("offen"),
    /** Kennung beim Anbieter, um eine Zustellung spaeter zuzuordnen. */
    anbieterId: text("anbieter_id"),
    /** Preis laut Anbieter, als Text — Waehrung steht daneben. */
    preis: text("preis"),
    fehler: text("fehler"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("lukas_sms_nummer_idx").on(t.nummer)],
);

export type SmsNachricht = typeof smsNachrichten.$inferSelect;
