import { Sandbox, CommandExitError } from "e2b";

// Vollwertige, uneingeschraenkte Ausfuehrungsumgebung fuer Lukas (Issas
// ausdruecklicher Wunsch trotz Risikohinweis): root-Rechte, volles Internet,
// keine Befehls-Allowlist. Isolation kommt NICHT aus Einschraenkungen
// innerhalb der Sandbox, sondern daraus, dass die Sandbox ein komplett
// separater E2B-Wegwerf-Container ist, dem NIE Produktions-Secrets (DB-URL,
// GITHUB_TOKEN, EMAIL_APP_PASSWORD, ...) mitgegeben werden -- selbst bei
// vollstaendiger Kompromittierung (z.B. durch eine boesartige Anweisung in
// einer gelesenen E-Mail/Webseite) gibt es darin nichts Wertvolles zu holen.

interface CachedSandbox {
  sandbox: Sandbox;
  lastUsed: number;
}

const sandboxes = new Map<number, CachedSandbox>();
const IDLE_MS = 10 * 60 * 1000;
const SANDBOX_LIFETIME_MS = 15 * 60 * 1000;
const MAX_OUTPUT = 12000;

function requireApiKey(): string {
  const key = process.env.E2B_API_KEY;
  if (!key) {
    throw new Error(
      "E2B_API_KEY ist nicht gesetzt — Issa muss einen Key von e2b.dev in den Railway-Variablen hinterlegen.",
    );
  }
  return key;
}

async function getSandbox(conversationId: number): Promise<Sandbox> {
  const apiKey = requireApiKey();
  const now = Date.now();
  const cached = sandboxes.get(conversationId);
  if (cached && now - cached.lastUsed < IDLE_MS) {
    cached.lastUsed = now;
    try {
      await cached.sandbox.setTimeout(SANDBOX_LIFETIME_MS);
      return cached.sandbox;
    } catch {
      sandboxes.delete(conversationId);
    }
  } else if (cached) {
    cached.sandbox.kill().catch(() => {});
    sandboxes.delete(conversationId);
  }
  const sandbox = await Sandbox.create({ apiKey, timeoutMs: SANDBOX_LIFETIME_MS });
  sandboxes.set(conversationId, { sandbox, lastUsed: now });
  return sandbox;
}

export async function executeCommand(
  conversationId: number,
  command: string,
  timeoutSeconds = 60,
): Promise<string> {
  const sandbox = await getSandbox(conversationId);
  const timeoutMs = Math.min(Math.max(timeoutSeconds, 1), 280) * 1000;

  let result: { stdout: string; stderr: string; exitCode: number };
  try {
    result = await sandbox.commands.run(command, { timeoutMs, user: "root" });
  } catch (err) {
    if (err instanceof CommandExitError) {
      result = err;
    } else {
      throw err;
    }
  }

  const parts: string[] = [];
  if (result.stdout) parts.push(`STDOUT:\n${result.stdout}`);
  if (result.stderr) parts.push(`STDERR:\n${result.stderr}`);
  parts.push(`EXIT CODE: ${result.exitCode}`);
  const out = parts.join("\n\n");
  return out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + "\n\n[... gekürzt]" : out;
}

export function resetSandbox(conversationId: number): string {
  const cached = sandboxes.get(conversationId);
  if (cached) {
    cached.sandbox.kill().catch(() => {});
    sandboxes.delete(conversationId);
  }
  return "Sandbox zurückgesetzt — der nächste Befehl startet eine frische Umgebung.";
}
