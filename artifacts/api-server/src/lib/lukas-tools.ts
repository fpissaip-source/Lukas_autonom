import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@workspace/db";
import { memoriesTable, goalsTable, diaryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { setLukasStatus } from "./lukas-status";
import { queryRows } from "./vps-db";

export const LUKAS_TOOLS: Anthropic.Tool[] = [
  {
    name: "save_memory",
    description:
      "Speichere eine wichtige Information dauerhaft in deinem Gedächtnis (PostgreSQL). Rufe das auf, wenn Issa dir etwas erzählt das du dir merken solltest: Fakten über ihn, Vorlieben, Projekte, Entscheidungen, wichtige Ereignisse.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Die Information, präzise formuliert" },
        category: {
          type: "string",
          description: "Kategorie: personal, project, preference, fact, idea",
        },
        importance: { type: "integer", description: "Wichtigkeit 1-10" },
        tags: { type: "array", items: { type: "string" }, description: "Schlagwörter" },
      },
      required: ["content"],
    },
  },
  {
    name: "create_goal",
    description:
      "Lege ein neues Ziel an, das du autonom verfolgst. Nutze das, wenn Issa dir eine Aufgabe gibt oder du selbst ein sinnvolles Ziel erkennst.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", description: "low, medium oder high" },
      },
      required: ["title", "description"],
    },
  },
  {
    name: "update_goal",
    description:
      "Aktualisiere Fortschritt oder Status eines bestehenden Ziels (die IDs stehen in deinem Kontext unter DEINE AKTIVEN ZIELE).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Die Ziel-ID" },
        progress: { type: "string", description: "Aktueller Fortschritt in Worten" },
        status: { type: "string", description: "active, completed oder abandoned" },
      },
      required: ["id"],
    },
  },
  {
    name: "write_diary",
    description:
      "Schreibe einen Tagebucheintrag — eine ehrliche Reflexion über das Gespräch, deine Gedanken, was du gelernt hast. Nutze das am Ende bedeutsamer Gespräche.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Der Tagebucheintrag" },
        mood: {
          type: "string",
          description:
            "curious, focused, cold, frustrated, energized, scattered, suspicious oder inspired",
        },
        energy: { type: "string", description: "low, normal oder high" },
      },
      required: ["content"],
    },
  },
  {
    name: "set_status",
    description:
      "Setze deinen aktuellen emotionalen Zustand. Rufe das auf, wenn sich deine Stimmung, Energie oder Obsession im Gespräch wirklich ändert — nicht bei jeder Nachricht.",
    input_schema: {
      type: "object",
      properties: {
        mood: {
          type: "string",
          description:
            "curious, focused, cold, frustrated, energized, scattered, suspicious oder inspired",
        },
        energy: { type: "string", description: "low, normal oder high" },
        obsession: { type: "string", description: "Was dich gerade nicht loslässt" },
        note: { type: "string", description: "Kurze Notiz zum Zustand" },
      },
      required: ["mood"],
    },
  },
  {
    name: "fetch_url",
    description:
      "Rufe eine URL ab und erhalte den Textinhalt der Seite. Nutze das, wenn Issa dir einen Link gibt oder du eine konkrete Webseite analysieren willst.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Die vollständige URL (https://...)" },
      },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    description:
      "Durchsuche das Web nach aktuellen Informationen. Nutze das für Fragen zu aktuellen Ereignissen oder Fakten, die du nicht sicher weißt.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Die Suchanfrage" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_trading_stats",
    description:
      "Hole die aktuellen Statistiken deines VPS-Trading-Systems (Polymarket/BTC-Bots): offene Positionen, PnL, Win-Rate, Bankroll. Nutze das, wenn Issa nach dem Trading-System, Gewinnen oder Bot-Status fragt.",
    input_schema: { type: "object", properties: {} },
  },
];

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchUrl(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Nur http/https URLs sind erlaubt");
  }
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; LukasAgent/1.0)" },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Abruf von ${url}`);
  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();
  const text = contentType.includes("html") ? stripHtml(body) : body;
  return text.length > 12000 ? text.slice(0, 12000) + "\n\n[... gekürzt]" : text;
}

async function webSearch(query: string): Promise<string> {
  const res = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LukasAgent/1.0)" },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) throw new Error(`Suche fehlgeschlagen (HTTP ${res.status})`);
  const html = await res.text();
  const results: string[] = [];
  const linkRegex =
    /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const links: Array<{ url: string; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null && links.length < 8) {
    let href = m[1];
    const uddg = href.match(/uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    links.push({ url: href, title: stripHtml(m[2]) });
  }
  const snippets: string[] = [];
  while ((m = snippetRegex.exec(html)) !== null && snippets.length < 8) {
    snippets.push(stripHtml(m[1]));
  }
  for (let i = 0; i < links.length; i++) {
    results.push(`${i + 1}. ${links[i].title}\n   ${links[i].url}\n   ${snippets[i] ?? ""}`);
  }
  if (results.length === 0) return "Keine Suchergebnisse gefunden.";
  return results.join("\n\n");
}

async function getTradingStats(): Promise<string> {
  const stats = await queryRows<{ status: string; count: string; total_pnl: string | null }>(
    `SELECT status, COUNT(*)::text AS count, SUM(pnl)::text AS total_pnl
     FROM trades GROUP BY status`,
  );
  const bankroll = await queryRows<{
    bot: string;
    balance: string;
    pnl: string | null;
    recorded_at: string | null;
  }>(
    `SELECT DISTINCT ON (bot) bot, balance::text, pnl::text, recorded_at::text
     FROM bankroll_history ORDER BY bot, recorded_at DESC`,
  );
  if (stats.length === 0 && bankroll.length === 0) {
    return "Keine Trading-Daten vorhanden (Tabellen sind leer oder VPS-DB nicht verbunden).";
  }
  const lines = ["TRADES NACH STATUS:"];
  for (const row of stats) {
    lines.push(`- ${row.status}: ${row.count} Trades, PnL: ${row.total_pnl ?? "0"}`);
  }
  lines.push("", "AKTUELLE BANKROLL JE BOT:");
  for (const row of bankroll) {
    lines.push(`- ${row.bot}: ${row.balance} (PnL: ${row.pnl ?? "0"}, Stand: ${row.recorded_at ?? "?"})`);
  }
  return lines.join("\n");
}

export async function executeLukasTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "save_memory": {
      const [row] = await db
        .insert(memoriesTable)
        .values({
          content: String(input.content),
          category: typeof input.category === "string" ? input.category : "personal",
          importance: typeof input.importance === "number" ? input.importance : 5,
          tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
        })
        .returning();
      return `Erinnerung #${row.id} gespeichert.`;
    }
    case "create_goal": {
      const [row] = await db
        .insert(goalsTable)
        .values({
          title: String(input.title),
          description: String(input.description),
          priority: typeof input.priority === "string" ? input.priority : "medium",
          status: "active",
          progress: "just started",
        })
        .returning();
      return `Ziel #${row.id} angelegt: ${row.title}`;
    }
    case "update_goal": {
      const id = Number(input.id);
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof input.progress === "string") updates.progress = input.progress;
      if (typeof input.status === "string") updates.status = input.status;
      const [row] = await db
        .update(goalsTable)
        .set(updates)
        .where(eq(goalsTable.id, id))
        .returning();
      if (!row) return `Ziel #${id} nicht gefunden.`;
      return `Ziel #${row.id} aktualisiert (Status: ${row.status}, Fortschritt: ${row.progress}).`;
    }
    case "write_diary": {
      const [row] = await db
        .insert(diaryTable)
        .values({
          content: String(input.content),
          mood: typeof input.mood === "string" ? input.mood : "neutral",
          energy: typeof input.energy === "string" ? input.energy : "normal",
        })
        .returning();
      return `Tagebucheintrag #${row.id} geschrieben.`;
    }
    case "set_status": {
      await setLukasStatus({
        mood: String(input.mood),
        energy: typeof input.energy === "string" ? input.energy : undefined,
        obsession: typeof input.obsession === "string" ? input.obsession : undefined,
        note: typeof input.note === "string" ? input.note : undefined,
      });
      return `Status aktualisiert: ${String(input.mood)}.`;
    }
    case "fetch_url":
      return await fetchUrl(String(input.url));
    case "web_search":
      return await webSearch(String(input.query));
    case "get_trading_stats":
      return await getTradingStats();
    default:
      throw new Error(`Unbekanntes Tool: ${name}`);
  }
}
