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
    /*
     * Der Fingerabdruck genau dieser Nachricht.
     *
     * Das Problem, gegen das er steht: die SMS geht raus, danach bricht das
     * Netz weg, der Agent haelt den Aufruf fuer gescheitert und versucht es
     * noch einmal. Der Empfaenger bekommt sie zweimal, und beim Anbieter
     * steht sie zweimal auf der Rechnung.
     *
     * Zusammengesetzt aus Nummer, Text und Quelle, mit einem Zeitfenster —
     * dieselbe Nachricht an dieselbe Nummer innerhalb weniger Minuten ist mit
     * grosser Wahrscheinlichkeit ein Wiederholungsversuch und keine Absicht.
     * Nach dem Fenster geht sie wieder durch: "Bin da" zweimal am Tag zu
     * schicken muss moeglich bleiben.
     */
    fingerabdruck: text("fingerabdruck"),
    fehler: text("fehler"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("lukas_sms_nummer_idx").on(t.nummer),
    index("lukas_sms_fingerabdruck_idx").on(t.fingerabdruck, t.createdAt),
  ],
);

export type SmsNachricht = typeof smsNachrichten.$inferSelect;
