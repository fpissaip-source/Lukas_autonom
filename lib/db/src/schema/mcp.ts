import { boolean, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/*
 * MCP-Server, die Issa im Dashboard eintraegt.
 *
 * Ein MCP-Server bringt Lukas fremde Werkzeuge bei — Kalender, Notion, was
 * auch immer. Der Zugang laeuft ueber OAuth: Issa meldet sich beim jeweiligen
 * Anbieter an, und der Anbieter gibt uns ein Token fuer genau seinen Account.
 *
 * Warum das hier in der Datenbank liegt und nicht im Speicher: Railway startet
 * Container neu, wann es will. Laege der OAuth-Zustand im Prozess, waere nach
 * jedem Neustart jede Verbindung weg und Issa muesste sich neu anmelden.
 */
export type McpToolSpec = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export const mcpServers = pgTable("lukas_mcp_servers", {
  id: serial("id").primaryKey(),
  // Kurzname, taucht auch im Werkzeugnamen auf: mcp__<slug>__<tool>
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),

  // new | awaiting_auth | connected | error
  status: text("status").notNull().default("new"),
  lastError: text("last_error"),

  /*
   * OAuth-Zustand. Das SDK erwartet genau diese Bausteine:
   *   clientInfo    Ergebnis der Dynamic Client Registration (client_id/secret)
   *   tokens        access_token, refresh_token, expires_in …
   *   codeVerifier  PKCE — muss den Redirect ueberleben, sonst schlaegt der
   *                 Tausch von Code gegen Token fehl
   *   oauthState    einmaliger Zufallswert; der Callback traegt keinen
   *                 Bearer-Token, deshalb ist DAS der Nachweis, dass die
   *                 Rueckleitung zu einem Anmeldevorgang gehoert, den wir
   *                 selbst gestartet haben
   */
  clientInfo: jsonb("client_info").$type<Record<string, unknown>>(),
  tokens: jsonb("tokens").$type<Record<string, unknown>>(),
  codeVerifier: text("code_verifier"),
  oauthState: text("oauth_state"),

  // Zuletzt vom Server gemeldete Werkzeuge — damit Lukas' Werkzeugliste ohne
  // Netzwerkaufruf aufgebaut werden kann.
  tools: jsonb("tools").$type<McpToolSpec[]>().notNull().default([]),
  toolsUpdatedAt: timestamp("tools_updated_at", { withTimezone: true }),

  /*
   * Risikostufe fuer ALLE Werkzeuge dieses Servers.
   *
   * Standard R2, also Freigabe vor jedem Aufruf. Das ist bewusst streng: was
   * ein fremder Server unter "create_event" oder "send_message" tatsaechlich
   * tut, wissen wir nicht, und die Beschreibung kommt vom Server selbst.
   * Issa kann einen Server, dem er vertraut, im Dashboard auf R1 stellen.
   */
  riskTier: text("risk_tier").notNull().default("R2"),
  enabled: boolean("enabled").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertMcpServerSchema = createInsertSchema(mcpServers).omit({
  id: true,
  createdAt: true,
});

export type McpServer = typeof mcpServers.$inferSelect;
export type InsertMcpServer = z.infer<typeof insertMcpServerSchema>;
