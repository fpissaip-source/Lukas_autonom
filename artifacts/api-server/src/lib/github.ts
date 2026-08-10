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
