/*
 * Schmaler GitHub-Zugang. Liegt bewusst eigenstaendig, damit sowohl Lukas'
 * Tools als auch die Vorschlags-Verwaltung ihn nutzen koennen, ohne sich
 * gegenseitig zu importieren.
 */

export async function githubRequest(
  path: string,
  init?: { method: "POST" | "PUT" | "PATCH"; body: unknown },
): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN ist nicht gesetzt — Issa muss einen GitHub Personal Access Token in den Railway-Variablen hinterlegen. Zum Lesen reicht 'Contents: Read-only'; damit Änderungen übernommen werden können, braucht es 'Contents: Read and write'.",
    );
  }
  const res = await fetch(`https://api.github.com${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "LukasAgent/1.0",
      ...(init ? { "Content-Type": "application/json" } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

let cachedGithubLogin: string | null = null;

export async function resolveGithubOwner(
  repoInput: string,
): Promise<{ owner: string; repo: string }> {
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

const OWN_REPO = (process.env.LUKAS_OWN_REPO?.trim() || "Lukas_autonom").toLowerCase();

/*
 * Branch, auf dem Lukas' eigener Code laeuft — der Branch, aus dem DIESER
 * Server gebaut wurde. Railway setzt RAILWAY_GIT_BRANCH selbst; ohne Railway
 * (lokal) faellt das auf null zurueck.
 *
 * Dieselbe Logik wie in lib/proposals.ts fuer "wohin ein angenommener
 * Vorschlag geschrieben wird" — beides beantwortet dieselbe Frage: welcher
 * Branch ist gerade der lebende Lukas.
 */
export function selfBranch(): string | null {
  const explicit = process.env.LUKAS_SELF_PATCH_BRANCH?.trim();
  if (explicit) return explicit;
  const railway = process.env.RAILWAY_GIT_BRANCH?.trim();
  return railway || null;
}

/*
 * Liefert den Branch, auf dem gelesen werden muss, wenn `repo` Lukas' eigenes
 * Repo ist — sonst null (fremde Repos lesen ganz normal ihren Default-Branch,
 * das ist dort das erwartete Verhalten).
 *
 * Der Hintergrund, warum das ueberhaupt noetig ist: GitHubs Contents-API und
 * Code-Search-API lesen ohne "ref" IMMER den Default-Branch. Der
 * Default-Branch von Lukas_autonom ist ein alter Replit-Ausgangsstand ohne
 * README, docs/, vps/ — der gesamte tatsaechliche Code lebt auf einem
 * Feature-Branch. Ohne diese Funktion liest github_read_path also nicht
 * "Lukas' eigenen Code", sondern ein Fossil, das mit dem laufenden System
 * nichts mehr zu tun hat. Genau das ist am 10.08. passiert: eine Suche nach
 * "transcribe" fand nichts, obwohl die Transkription seit Wochen eingebaut
 * ist — sie lag nur auf dem falschen Branch.
 */
export function ownRepoRef(repo: string): string | null {
  return repo.toLowerCase() === OWN_REPO ? selfBranch() : null;
}
