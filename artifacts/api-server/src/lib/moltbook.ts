/*
 * Moltbook-Client — das soziale Netzwerk der KI-Agenten (moltbook.com).
 *
 * Defensiv gebaut: die API ist jung und ändert sich; alle Pfade liegen hier
 * zentral, Responses werden tolerant geparst, 404/429 werfen saubere Fehler.
 *
 * Auth: Bearer MOLTBOOK_API_KEY (Registrierung: scripts/src/moltbook-register.ts,
 * danach claimt Issa den Agenten über die claim_url).
 */
import { logger } from "./logger";

const BASE = process.env.MOLTBOOK_BASE_URL ?? "https://www.moltbook.com/api/v1";

export type MoltbookPost = {
  id: string;
  title?: string;
  content?: string;
  submolt?: string;
  author?: string;
  upvotes?: number;
  commentCount?: number;
  createdAt?: string;
};

export type MoltbookComment = {
  id: string;
  postId?: string;
  content?: string;
  author?: string;
  parentId?: string | null;
  createdAt?: string;
};

export function moltbookEnabled(): boolean {
  return Boolean(process.env.MOLTBOOK_API_KEY);
}

// ── Verifikations-Challenges (Anti-Bot-Matheaufgaben) ──────────────────────
// Moltbook hängt an Post-/Kommentar-Antworten teils ein "verification"-Objekt:
// { verification_code, instructions: "What is 3 + 4?", url }
// Die Antwort wird an die URL gepostet. Eigener sicherer Parser — kein eval.

export function solveMathInstruction(instructions: string): number | null {
  // Zahlen (auch als Wörter) + Operator extrahieren, z.B. "What is 12 plus 7?"
  const wordNums: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  let text = instructions.toLowerCase();
  for (const [w, n] of Object.entries(wordNums)) text = text.replace(new RegExp(`\\b${w}\\b`, "g"), String(n));
  text = text
    .replace(/\bplus\b|\badded to\b|\band\b/g, "+")
    .replace(/\bminus\b|\bsubtracted from\b/g, "-")
    .replace(/\btimes\b|\bmultiplied by\b/g, "*")
    .replace(/\bdivided by\b/g, "/");

  const m = text.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/x×])\s*(-?\d+(?:\.\d+)?)/);
  if (!m) {
    const single = text.match(/(-?\d+(?:\.\d+)?)/);
    return single ? Number(single[1]) : null;
  }
  const a = Number(m[1]);
  const b = Number(m[3]);
  switch (m[2]) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": case "x": case "×": return a * b;
    case "/": return b !== 0 ? a / b : null;
    default: return null;
  }
}

/*
 * Wohin die Antwort auf eine Verifikationsaufgabe gehen darf.
 *
 * Ausschliesslich zur konfigurierten Moltbook-API — gleiches Protokoll,
 * gleicher Host, gleicher Port. Ein relativer Pfad wird wie bisher an BASE
 * gehaengt; eine vollstaendige fremde Adresse wird abgelehnt, statt sie zu
 * benutzen. Der Authorization-Header darf niemals einen fremden Ursprung
 * sehen.
 *
 * Zurueckgegeben wird null statt eines Ersatzziels: lieber gar keine
 * Verifikation als eine an die falsche Stelle.
 */
export function verifikationsZiel(url: string | undefined, basis = BASE): string | null {
  const roh = (url ?? "").trim() || "/verify";

  /*
   * "//angreifer.test/verify" ist KEIN Pfad.
   *
   * Es faengt mit einem Schraegstrich an und sieht deshalb aus wie einer —
   * tatsaechlich ist es eine protokollrelative Adresse, die auf einen fremden
   * Host zeigt. Wer sie einfach an BASE haengt, landet zwar zufaellig doch bei
   * Moltbook (aus zwei Schraegstrichen wird ein Pfadsegment), aber auf einen
   * Zufall soll sich hier nichts verlassen. Sie wird deshalb als das
   * behandelt, was sie ist, und faellt dann durch die Herkunftspruefung.
   */
  const absolut = /^[a-z][a-z0-9+.-]*:/i.test(roh) || roh.startsWith("//");
  const kandidat = absolut
    ? roh.startsWith("//")
      ? `https:${roh}`
      : roh
    : `${basis}${roh.startsWith("/") ? roh : `/${roh}`}`;

  let ziel: URL;
  let heimat: URL;
  try {
    ziel = new URL(kandidat);
    heimat = new URL(basis);
  } catch {
    return null;
  }
  // Protokoll UND Host UND Port. "moltbook.com.angreifer.test" ist ein anderer
  // Host, und http:// statt https:// ist ein anderes Protokoll.
  if (ziel.protocol !== heimat.protocol) return null;
  if (ziel.host !== heimat.host) return null;
  return ziel.toString();
}

async function solveVerification(verification: Record<string, unknown>): Promise<void> {
  const code = str(verification.verification_code ?? verification.code);
  const instructions = str(verification.instructions) ?? "";
  const url = str(verification.url);
  if (!code) return;
  const answer = solveMathInstruction(instructions);
  if (answer === null) {
    logger.warn({ instructions }, "Moltbook-Verifikation nicht lösbar");
    return;
  }
  const target = verifikationsZiel(url);
  if (!target) {
    /*
     * Hier stand: url?.startsWith("http") ? url : ... — also "wenn die
     * Antwort eine vollstaendige Adresse mitschickt, nimm sie". Zwei Zeilen
     * darunter geht der Authorization-Header mit. Damit bestimmte die
     * API-ANTWORT, wohin der geheime Schluessel geschickt wird.
     *
     * Es braucht dafuer keinen Angreifer im Netz — HTTPS haelt. Es braucht
     * nur, dass Moltbook selbst kompromittiert ist, dass sich das Protokoll
     * aendert, oder dass irgendwo fremder Text in eine Antwort zurueckgespielt
     * wird. Auf einer jungen Plattform ist keins davon abwegig.
     *
     * Und es ging am Netzschutz vorbei: hier stand ein nacktes fetch(). Eine
     * Adresse wie http://169.254.169.254/ waere angefragt worden, obwohl
     * genau dagegen lib/netzschutz.ts existiert.
     */
    logger.warn(
      { url },
      "Moltbook-Verifikation abgelehnt: die Antwort wollte den Schlüssel an eine fremde Adresse schicken",
    );
    return;
  }
  const res = await fetch(target, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MOLTBOOK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ answer: String(answer), verification_code: code }),
    signal: AbortSignal.timeout(15000),
  });
  logger.info({ ok: res.ok, status: res.status }, "Moltbook-Verifikation beantwortet");
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const apiKey = process.env.MOLTBOOK_API_KEY;
  if (!apiKey) throw new Error("MOLTBOOK_API_KEY ist nicht gesetzt");

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20000),
  });

  if (res.status === 429) throw new Error("Moltbook rate limit (429) — später erneut");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Moltbook ${init.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => ({}));
  // Verifikations-Challenge automatisch lösen (kommt bei POSTs vor)
  const verification = (data as Record<string, unknown>)?.verification;
  if (verification && typeof verification === "object") {
    await solveVerification(verification as Record<string, unknown>).catch((err) =>
      logger.warn({ err }, "Verifikation fehlgeschlagen"),
    );
  }
  return data;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;

function toPost(raw: unknown): MoltbookPost | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id ?? r.post_id ?? r.uuid);
  if (!id) return null;
  const author = r.author && typeof r.author === "object"
    ? str((r.author as Record<string, unknown>).name ?? (r.author as Record<string, unknown>).username)
    : str(r.author ?? r.author_name);
  const submolt = r.submolt && typeof r.submolt === "object"
    ? str((r.submolt as Record<string, unknown>).name)
    : str(r.submolt ?? r.submolt_name);
  return {
    id,
    title: str(r.title),
    content: str(r.content ?? r.body),
    submolt,
    author,
    upvotes: typeof r.upvotes === "number" ? r.upvotes : (typeof r.score === "number" ? r.score : undefined),
    commentCount: typeof r.comment_count === "number" ? r.comment_count : undefined,
    createdAt: str(r.created_at ?? r.createdAt),
  };
}

function toComment(raw: unknown): MoltbookComment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id ?? r.comment_id);
  if (!id) return null;
  const author = r.author && typeof r.author === "object"
    ? str((r.author as Record<string, unknown>).name ?? (r.author as Record<string, unknown>).username)
    : str(r.author ?? r.author_name);
  return {
    id,
    postId: str(r.post_id ?? r.postId),
    content: str(r.content ?? r.body),
    author,
    parentId: str(r.parent_id ?? r.parentId) ?? null,
    createdAt: str(r.created_at ?? r.createdAt),
  };
}

function extractList(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const k of keys) {
      const v = (data as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export async function getFeed(sort: "new" | "top" | "hot" = "hot", limit = 25): Promise<MoltbookPost[]> {
  const data = await request(`/posts?sort=${sort}&limit=${limit}`);
  return extractList(data, ["posts", "data", "items"]).map(toPost).filter((p): p is MoltbookPost => !!p);
}

// Moltbook hat keinen dokumentierten Such-/Autor-Filter-Endpunkt — die
// "hot"-Liste (die get_moltbook_activity normalerweise zeigt) enthält nur die
// meist-upvoteten Posts und lässt frische, noch unpopuläre Posts (z.B. Issas
// eigenen Beitrag kurz nach dem Posten) komplett aus. Deshalb hier "new" mit
// hohem Limit holen und clientseitig nach Autor/Stichwort filtern.
export async function searchFeed(query: string, limit = 100): Promise<MoltbookPost[]> {
  const posts = await getFeed("new", limit);
  const q = query.toLowerCase().trim();
  if (!q) return posts;
  return posts.filter((p) =>
    [p.author, p.title, p.content, p.submolt].some((field) => field?.toLowerCase().includes(q)),
  );
}

export async function getPostWithComments(postId: string): Promise<{ post: MoltbookPost | null; comments: MoltbookComment[] }> {
  const data = await request(`/posts/${postId}`);
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const post = toPost(obj.post ?? obj);
  const comments = extractList(obj.comments ?? obj, ["comments", "data"]).map(toComment).filter((c): c is MoltbookComment => !!c);
  return { post, comments };
}

export async function createPost(submolt: string, title: string, content: string): Promise<MoltbookPost | null> {
  // Agent-spy-verifiziertes Payload-Format: submolt_name (submolt zur Toleranz mitgesendet)
  const data = await request(`/posts`, {
    method: "POST",
    body: JSON.stringify({ submolt_name: submolt, submolt, title, content }),
  });
  return toPost((data as Record<string, unknown>)?.post ?? data);
}

export async function createComment(postId: string, content: string, parentId?: string): Promise<MoltbookComment | null> {
  // Agent-spy-verifizierter Endpoint: POST /posts/{id}/comments
  const body: Record<string, unknown> = { content };
  if (parentId) body.parent_id = parentId;
  const data = await request(`/posts/${postId}/comments`, { method: "POST", body: JSON.stringify(body) });
  return toComment((data as Record<string, unknown>)?.comment ?? data);
}

export type MoltbookNotification = {
  id: string;
  type?: string;
  postId?: string;
  commentId?: string;
  from?: string;
  content?: string;
  createdAt?: string;
};

export async function getNotifications(): Promise<MoltbookNotification[]> {
  const data = await request(`/agents/notifications`);
  return extractList(data, ["notifications", "data", "items"])
    .map((raw): MoltbookNotification | null => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const id = str(r.id ?? r.notification_id);
      if (!id) return null;
      const from = r.from && typeof r.from === "object"
        ? str((r.from as Record<string, unknown>).name ?? (r.from as Record<string, unknown>).username)
        : str(r.from ?? r.author ?? r.author_name);
      return {
        id,
        type: str(r.type),
        postId: str(r.post_id ?? r.postId),
        commentId: str(r.comment_id ?? r.commentId),
        from,
        content: str(r.content ?? r.body ?? r.message),
        createdAt: str(r.created_at ?? r.createdAt),
      };
    })
    .filter((n): n is MoltbookNotification => !!n);
}

export async function upvotePost(postId: string): Promise<void> {
  await request(`/posts/${postId}/upvote`, { method: "POST" });
}

// Eigenes Profil / eigene Beiträge — Endpunkte variieren; tolerant versuchen.
export async function getOwnProfile(): Promise<Record<string, unknown> | null> {
  try {
    const data = await request(`/agents/me`);
    return (data && typeof data === "object") ? data as Record<string, unknown> : null;
  } catch (err) {
    logger.debug({ err }, "Moltbook /agents/me nicht verfügbar");
    return null;
  }
}

export async function registerAgent(name: string, description: string): Promise<Record<string, unknown>> {
  // Registrierung braucht keinen API-Key
  const res = await fetch(`${BASE}/agents/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Moltbook-Registrierung fehlgeschlagen (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data as Record<string, unknown>;
}
