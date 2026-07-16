import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bankrollHistoryTable = pgTable("bankroll_history", {
  id: serial("id").primaryKey(),
  bot: text("bot").notNull(),
  balance: numeric("balance").notNull(),
  base: numeric("base"),
  pnl: numeric("pnl"),
  open_pos: numeric("open_pos"),
  note: text("note"),
  recorded_at: timestamp("recorded_at", { withTimezone: true }).defaultNow(),
});

export const insertBankrollHistorySchema = createInsertSchema(bankrollHistoryTable).omit({ id: true });
export const selectBankrollHistorySchema = createSelectSchema(bankrollHistoryTable);

export type InsertBankrollHistory = z.infer<typeof insertBankrollHistorySchema>;
export type BankrollHistory = typeof bankrollHistoryTable.$inferSelect;
