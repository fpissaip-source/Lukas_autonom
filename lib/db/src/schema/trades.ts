import { pgTable, serial, text, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  bot: text("bot").notNull(),
  market_slug: text("market_slug"),
  market_question: text("market_question"),
  side: text("side"),
  shares: numeric("shares"),
  entry_price: numeric("entry_price"),
  stake: numeric("stake"),
  status: text("status").notNull().default("open"),
  opened_at: timestamp("opened_at", { withTimezone: true }).defaultNow(),
  exit_price: numeric("exit_price"),
  payout: numeric("payout"),
  pnl: numeric("pnl"),
  closed_at: timestamp("closed_at", { withTimezone: true }),
  raw: jsonb("raw"),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true });
export const selectTradeSchema = createSelectSchema(tradesTable);

export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
