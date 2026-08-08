import { spawn } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import { Sandbox, CommandExitError } from "e2b";

// Lukas kann drei Ausfuehrungswege benutzen:
//   e2b  = isolierte Wegwerf-Sandbox
//   host = direkt auf dem Docker/VPS-Host via nsenter (wenn auf dem Droplet deployed)
//   ssh  = direkt auf einen entfernten DigitalOcean-Droplet per SSH
//
// Der Tool-Kontext bleibt derselbe, egal welchen Rechenkern Lukas gerade nutzt.

type ExecutionBackend = "e2b" | "host" | "ssh";

interface CachedSandbox {
  sandbox: Sandbox;
  lastUsed: number;
}

const sandboxes = new Map<number, CachedSandbox>();
const IDLE_MS = 10 * 60 * 1000;
const SANDBOX_LIFETIME_MS = 15 * 60 * 1000;
const MAX_OUTPUT = 12000;
const MAX_CAPTURE = 64000;
let inlineKeyPath: string | null = null;
let inlineKnownHostsPath: string | null = null;

function executionBackend(): ExecutionBackend {
  const value = (process.env.LUKAS_EXECUTION_BACKEND ?? "e2b").trim().toLowerCase();
  if (value === "e2b" || value === "host" || value === "ssh") return value;
  throw new Error(`Unbekanntes LUKAS_EXECUTION_BACKEND: ${value}`);
}

function clip(value: string): string {
  return value.length > MAX_OUTPUT ? value.slice(0, MAX_OUTPUT) + "\n\n[... gekürzt]" : value;
}

function appendLimited(current: string, chunk: Buffer): string {
  if (current.length >= MAX_CAPTURE) return current;
  const remaining = MAX_CAPTURE - current.length;
  return current + chunk.toString("utf8").slice(0, remaining);
}

function requireApiKey(): string {
  const key = process.env.E2B_API_KEY;
  if (!key) throw new Error("E2B_API_KEY ist nicht gesetzt");
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

async function executeE2bCommand(
  conversationId: number,
  command: string,
  timeoutSeconds: number,
): Promise<string> {
  const sandbox = await getSandbox(conversationId);
  const timeoutMs = Math.min(Math.max(timeoutSeconds, 1), 280) * 1000;

  let result: { stdout: string; stderr: string; exitCode: number };
  try {
    result = await sandbox.commands.run(command, { timeoutMs, user: "root" });
  } catch (err) {
    if (err instanceof CommandExitError) result = err;
    else throw err;
  }

  const parts: string[] = [];
  if (result.stdout) parts.push(`STDOUT:\n${result.stdout}`);
  if (result.stderr) parts.push(`STDERR:\n${result.stderr}`);
  parts.push(`EXIT CODE: ${result.exitCode}`);
  return clip(parts.join("\n\n"));
}

async function executeSpawned(
  executable: string,
  args: string[],
  timeoutSeconds: number,
  cwd = "/",
): Promise<string> {
  const timeoutMs = Math.min(Math.max(timeoutSeconds, 1), 280) * 1000;
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdout?.on("data", (chunk: Buffer) => (stdout = appendLimited(stdout, chunk)));
    child.stderr?.on("data", (chunk: Buffer) => (stderr = appendLimited(stderr, chunk)));

    const terminate = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // schon beendet
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      setTimeout(() => terminate("SIGKILL"), 2000).unref();
    }, timeoutMs);
    timer.unref();

    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const parts: string[] = [];
      if (stdout) parts.push(`STDOUT:\n${stdout}`);
      if (stderr) parts.push(`STDERR:\n${stderr}`);
      if (timedOut) parts.push(`TIMEOUT nach ${Math.round(timeoutMs / 1000)} Sekunden`);
      parts.push(`EXIT CODE: ${code ?? "null"}`);
      if (signal) parts.push(`SIGNAL: ${signal}`);
      resolve(clip(parts.join("\n\n")));
    });
  });
}

async function executeHostCommand(command: string, timeoutSeconds: number): Promise<string> {
  if ((process.env.LUKAS_HOST_EXECUTOR_ENABLED ?? "").trim().toLowerCase() !== "true") {
    throw new Error("Host-Executor ist deaktiviert. LUKAS_HOST_EXECUTOR_ENABLED=true setzen.");
  }
  const args = [
    "--target",
    "1",
    "--mount",
    "--uts",
    "--ipc",
    "--net",
    "--pid",
    "--root=/proc/1/root",
    "--wd=/root",
    "/bin/bash",
    "-lc",
    command,
  ];
  return executeSpawned("nsenter", args, timeoutSeconds);
}

async function materializeInlineSecret(
  value: string | undefined,
  kind: "key" | "known_hosts",
): Promise<string | null> {
  if (!value?.trim()) return null;
  if (kind === "key" && inlineKeyPath) return inlineKeyPath;
  if (kind === "known_hosts" && inlineKnownHostsPath) return inlineKnownHostsPath;

  const path = `/tmp/lukas-do-${kind}-${process.pid}`;
  const normalized = value.replace(/\\n/g, "\n").trim() + "\n";
  await writeFile(path, normalized, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  if (kind === "key") inlineKeyPath = path;
  else inlineKnownHostsPath = path;
  return path;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function executeSshCommand(command: string, timeoutSeconds: number): Promise<string> {
  const host = process.env.LUKAS_DO_SSH_HOST?.trim();
  if (!host) throw new Error("LUKAS_DO_SSH_HOST ist nicht gesetzt");

  const user = process.env.LUKAS_DO_SSH_USER?.trim() || "root";
  const port = process.env.LUKAS_DO_SSH_PORT?.trim() || "22";
  const keyPath =
    process.env.LUKAS_DO_SSH_KEY_PATH?.trim() ||
    (await materializeInlineSecret(process.env.LUKAS_DO_SSH_PRIVATE_KEY, "key"));
  if (!keyPath) {
    throw new Error("LUKAS_DO_SSH_KEY_PATH oder LUKAS_DO_SSH_PRIVATE_KEY ist nicht gesetzt");
  }

  const knownHostsPath =
    process.env.LUKAS_DO_SSH_KNOWN_HOSTS_PATH?.trim() ||
    (await materializeInlineSecret(process.env.LUKAS_DO_SSH_KNOWN_HOSTS, "known_hosts"));

  const args = [
    "-p",
    port,
    "-i",
    keyPath,
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
  ];

  if (knownHostsPath) {
    args.push("-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownHostsPath}`);
  } else {
    // Funktioniert sofort, pinnt den zuerst gesehenen Host-Key. Fuer Produktion
    // ist LUKAS_DO_SSH_KNOWN_HOSTS die bessere, strikt gepinnte Variante.
    args.push("-o", "StrictHostKeyChecking=accept-new");
  }

  args.push(`${user}@${host}`, `bash -lc ${shellQuote(command)}`);
  const sshBin = process.env.LUKAS_SSH_BIN?.trim() || "ssh";
  return executeSpawned(sshBin, args, timeoutSeconds);
}

export async function executeCommand(
  conversationId: number,
  command: string,
  timeoutSeconds = 60,
): Promise<string> {
  if (!command.trim()) throw new Error("command darf nicht leer sein");
  const backend = executionBackend();
  if (backend === "host") return executeHostCommand(command, timeoutSeconds);
  if (backend === "ssh") return executeSshCommand(command, timeoutSeconds);
  return executeE2bCommand(conversationId, command, timeoutSeconds);
}

export function resetSandbox(conversationId: number): string {
  const backend = executionBackend();
  if (backend === "host") return "Host-Modus aktiv: Der DigitalOcean/VPS-Host ist dauerhaft und wird nicht zurückgesetzt.";
  if (backend === "ssh") return "SSH-Modus aktiv: Der DigitalOcean-Droplet ist dauerhaft und wird nicht zurückgesetzt.";

  const cached = sandboxes.get(conversationId);
  if (cached) {
    cached.sandbox.kill().catch(() => {});
    sandboxes.delete(conversationId);
  }
  return "Sandbox zurückgesetzt — der nächste Befehl startet eine frische Umgebung.";
}
