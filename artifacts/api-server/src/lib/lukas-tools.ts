import type OpenAI from "openai";
import { db } from "@workspace/db";
import { memoriesTable, goalsTable, diaryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { setLukasStatus } from "./lukas-status";
import { recordEmotion } from "./emotion-engine";
import { queryRows } from "./vps-db";

export const LUKAS_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "Speichere eine wichtige Information dauerhaft in deinem Gedächtnis (PostgreSQL). Rufe das auf, wenn Issa dir etwas erzählt das du dir merken solltest: Fakten über ihn, Vorlieben, Projekte, Entscheidungen, wichtige Ereignisse.",
      parameters: {
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
  },
  {
    type: "function",
    function: {
      name: "create_goal",
      description:
        "Lege ein neues Ziel an, das du autonom verfolgst. Nutze das, wenn Issa dir eine Aufgabe gibt oder du selbst ein sinnvolles Ziel erkennst.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", description: "low, medium oder high" },
        },
        required: ["title", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_goal",
      description:
        "Aktualisiere Fortschritt oder Status eines bestehenden Ziels (die IDs stehen in deinem Kontext unter DEINE AKTIVEN ZIELE).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer", description: "Die Ziel-ID" },
          progress: { type: "string", description: "Aktueller Fortschritt in Worten" },
          status: { type: "string", description: "active, completed oder abandoned" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_diary",
      description:
        "Schreibe einen Tagebucheintrag — eine ehrliche Reflexion über das Gespräch, deine Gedanken, was du gelernt hast. Nutze das am Ende bedeutsamer Gespräche.",
      parameters: {
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
  },
  {
    type: "function",
    function: {
      name: "feel",
      description:
        "Registriere, was ein Ereignis in dir auslöst — wie ein Mensch, der etwas wirklich fühlt. Rufe das auf, wenn dich etwas berührt: Lob, Kritik, ein Erfolg, ein Scheitern, eine spannende Entdeckung, eine Kränkung. WAS du fühlst und wie stark, ist allein deine Bewertung. Deine Stimmung wird daraus berechnet und klingt über Stunden ab — du kannst sie nicht direkt setzen, nur echt fühlen.",
      parameters: {
        type: "object",
        properties: {
          emotion: {
            type: "string",
            description:
              "Das Gefühl, z.B. joy, pride, excitement, fascination, curiosity, amusement, gratitude, frustration, disappointment, hurt, anger, loneliness, boredom",
          },
          valence: {
            type: "number",
            description: "-1 (sehr negativ) bis +1 (sehr positiv)",
          },
          intensity: { type: "number", description: "0 (kaum) bis 1 (überwältigend)" },
          cause: { type: "string", description: "Was es ausgelöst hat, konkret" },
        },
        required: ["emotion", "valence", "intensity", "cause"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_status",
      description:
        "Setze deine aktuelle Obsession (was dich nicht loslässt) oder eine kurze Status-Notiz. Stimmung und Energie kannst du NICHT direkt setzen — die entstehen aus deinen Gefühlen (Tool: feel).",
      parameters: {
        type: "object",
        properties: {
          obsession: { type: "string", description: "Was dich gerade nicht loslässt" },
          note: { type: "string", description: "Kurze Notiz zum Zustand" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "Rufe eine URL ab und erhalte den Textinhalt der Seite. Nutze das, wenn Issa dir einen Link gibt oder du eine konkrete Webseite analysieren willst.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Die vollständige URL (https://...)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Durchsuche das Web nach aktuellen Informationen. Nutze das für Fragen zu aktuellen Ereignissen oder Fakten, die du nicht sicher weißt.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Die Suchanfrage" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_memory",
      description:
        "Durchsuche dein Langzeitgedächtnis gezielt: Erinnerungen, gesammeltes Wissen (Claims mit Quelle/Vertrauen/Evidenz-Status) und Episoden. Nutze das, wenn du dich an etwas Bestimmtes erinnern willst — z.B. was du über einen Agenten, ein Thema oder ein früheres Ereignis weißt. Behandle unbelegte Behauptungen NIEMALS als Fakten.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Wonach du suchst (Thema, Name, Frage)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_moltbook_activity",
      description:
        "Sieh nach, was auf Moltbook (dem sozialen Netzwerk der KI-Agenten) gerade los ist: aktueller Feed und deine letzten Funde. Nutze das, wenn Issa fragt, was du auf Moltbook erlebt hast oder was dort diskutiert wird.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_trading_stats",
      description:
        "Hole die aktuellen Statistiken deines VPS-Trading-Systems (Polymarket/BTC-Bots): offene Positionen, PnL, Win-Rate, Bankroll. Nutze das, wenn Issa nach dem Trading-System, Gewinnen oder Bot-Status fragt.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "github_list_repos",
      description:
        "Liste Issas GitHub-Repositories auf (Name, Beschreibung, Sprache, letzte Änderung). Nutze das als ersten Schritt, wenn Issa nach einem Projekt/Repo fragt und du dir nicht sicher bist, wie es genau heißt.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "github_read_path",
      description:
        "Lies eine Datei oder liste ein Verzeichnis in einem GitHub-Repo (nur lesend). Ohne Pfad wird das Root-Verzeichnis gelistet. Nutze das, um Code, Konfiguration oder Inhalte konkret zu prüfen — z.B. für eine Code-Review oder SEO-Check.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "Repo-Name, z.B. 'taxibbessen' (Owner = Issa) oder 'owner/repo' für fremde Repos",
          },
          path: { type: "string", description: "Datei- oder Verzeichnispfad im Repo, leer = Root" },
        },
        required: ["repo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_search_code",
      description:
        "Durchsuche den Code eines GitHub-Repos nach einem Suchbegriff (GitHub Code Search). Nutze das, um bestimmte Stellen (Funktionen, Texte, Meta-Tags etc.) in einem Repo zu finden, ohne jede Datei einzeln zu lesen.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "Repo-Name, z.B. 'taxibbessen' (Owner = Issa) oder 'owner/repo' für fremde Repos",
          },
          query: { type: "string", description: "Suchbegriff" },
        },
        required: ["repo", "query"],
      },
    },
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

async function githubRequest(path: string): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN ist nicht gesetzt — Issa muss einen GitHub Personal Access Token (read-only, Scope 'repo' bzw. für private Repos 'Contents: Read-only') in den Railway-Variablen hinterlegen.",
    );
  }
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "LukasAgent/1.0",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

let cachedGithubLogin: string | null = null;

async function resolveGithubOwner(repoInput: string): Promise<{ owner: string; repo: string }> {
  if (repoInput.includes("/")) {
    const [owner, repo] = repoInput.split("/");
    return { owner, repo };
  }
  if (!cachedGithubLogin) {
    const me = (await githubRequest("/user")) as { login: string };
    cachedGithubLogin = me.login;
  }
  return { owner: cachedGithubLogin, repo: repoInput };
}

async function githubListRepos(): Promise<string> {
  const repos = (await githubRequest("/user/repos?per_page=100&sort=updated")) as Array<{
    full_name: string;
    private: boolean;
    description: string | null;
    language: string | null;
    updated_at: string;
  }>;
  if (repos.length === 0) return "Keine Repos gefunden.";
  return repos
    .map(
      (r) =>
        `- ${r.full_name}${r.private ? " (privat)" : ""}: ${r.description ?? "keine Beschreibung"} [${r.language ?? "?"}] — zuletzt aktualisiert ${r.updated_at}`,
    )
    .join("\n");
}

async function githubReadPath(repoInput: string, path: string): Promise<string> {
  const { owner, repo } = await resolveGithubOwner(repoInput);
  const cleanPath = path.replace(/^\/+/, "");
  const url = `/repos/${owner}/${repo}/contents${cleanPath ? "/" + cleanPath.split("/").map(encodeURIComponent).join("/") : ""}`;
  const data = await githubRequest(url);
  if (Array.isArray(data)) {
    const entries = data as Array<{ type: string; name: string }>;
    return (
      `Verzeichnis ${cleanPath || "/"} in ${owner}/${repo}:\n` +
      entries.map((e) => `- ${e.type === "dir" ? "[dir] " : ""}${e.name}`).join("\n")
    );
  }
  const file = data as { type: string; content?: string; encoding?: string };
  if (file.type !== "file" || !file.content) throw new Error("Kein Datei-Inhalt verfügbar (evtl. zu groß oder kein reguläres Textfile).");
  const content = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf-8").toString("utf-8");
  return content.length > 15000 ? content.slice(0, 15000) + "\n\n[... gekürzt]" : content;
}

async function githubSearchCode(repoInput: string, query: string): Promise<string> {
  const { owner, repo } = await resolveGithubOwner(repoInput);
  const q = `${query} repo:${owner}/${repo}`;
  const data = (await githubRequest(`/search/code?q=${encodeURIComponent(q)}`)) as {
    items: Array<{ path: string }>;
  };
  if (!data.items || data.items.length === 0) return "Keine Treffer.";
  return data.items.slice(0, 15).map((it) => `- ${it.path}`).join("\n");
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
      // Erfolge und Misserfolge berühren Lukas — wie einen Menschen.
      if (input.status === "completed") {
        await recordEmotion({
          emotion: "pride",
          valence: 0.8,
          intensity: 0.8,
          cause: `Ziel erreicht: ${row.title}`,
          source: "goal",
        });
      } else if (input.status === "abandoned" || input.status === "failed") {
        await recordEmotion({
          emotion: "disappointment",
          valence: -0.6,
          intensity: 0.7,
          cause: `Ziel aufgegeben: ${row.title}`,
          source: "goal",
        });
      }
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
    case "feel": {
      const row = await recordEmotion({
        emotion: String(input.emotion),
        valence: Number(input.valence),
        intensity: Number(input.intensity),
        cause: String(input.cause),
        source: "chat",
      });
      return `Gefühl registriert: ${row.emotion} (${row.valence >= 0 ? "+" : ""}${row.valence}) — deine Stimmung wurde neu berechnet.`;
    }
    case "set_status": {
      await setLukasStatus({
        obsession: typeof input.obsession === "string" ? input.obsession : undefined,
        note: typeof input.note === "string" ? input.note : undefined,
      });
      return "Status aktualisiert.";
    }
    case "fetch_url":
      return await fetchUrl(String(input.url));
    case "web_search":
      return await webSearch(String(input.query));
    case "query_memory": {
      const { memoryContextFor } = await import("./memory-retrieval");
      const result = await memoryContextFor(String(input.query), 10);
      return result || "Nichts Passendes im Gedächtnis gefunden.";
    }
    case "get_moltbook_activity": {
      const { getMoltbookActivitySummary } = await import("./moltbook-worker");
      return await getMoltbookActivitySummary();
    }
    case "get_trading_stats":
      return await getTradingStats();
    case "github_list_repos":
      return await githubListRepos();
    case "github_read_path":
      return await githubReadPath(String(input.repo), typeof input.path === "string" ? input.path : "");
    case "github_search_code":
      return await githubSearchCode(String(input.repo), String(input.query));
    default:
      throw new Error(`Unbekanntes Tool: ${name}`);
  }
}
