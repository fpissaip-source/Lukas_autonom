import { spawn } from "node:child_process";
import { Sandbox, CommandExitError } from "e2b";

// Lukas kann Befehle entweder in einer isolierten E2B-Sandbox oder direkt auf
// dem eigenen VPS ausfuehren. Auf dem DigitalOcean-Deployment wird bewusst der
// Host-Backend verwendet: root, dauerhaft, volles Internet, keine Allowlist.
// Der oeffentliche Portfolio-Chat bekommt dieses Tool nicht; erreichbar ist es
// nur ueber den privaten, durch LUKAS_API_TOKEN geschuetzten Lukas-Chat.

type ExecutionBackend = "e2b" | "host";

interface CachedSandbox {
  sandbox: Sandbox;
  lastUsed: number;
}

const sandboxes = new Map<number, CachedSandbox>();
const IDLE_MS = 10 * 60 * 1000;
const SANDBOX_LIFETIME_MS = 15 * 60 * 1000;
const MAX_OUTPUT = 12000;
const MAX_CAPTURE = 64000;

function executionBackend(): ExecutionBackend {
  const value = (process.env.LUKAS_EXECUTION_BACKEND ?? "e2b").trim().toLowerCase();
  if (value === "e2b" || value === "host") return value;
  throw new Error(`Unbekanntes LUKAS_EXECUTION_BACKEND: ${value}`);
}

function clip(value: string): string {
  return value.length > MAX_OUTPUT ? value.slice(0, MAX_OUTPUT) + "\n\n[... gekuerzt]" : value;
}

function appendLimited(current: string, chunk: Buffer): string {
  if (current.length >= MAX_CAPTURE) return current;
  const remaining = MAX_CAPTURE - current.length;
  return current + chunk.toString("utf8").slice(0, remaining);
}

function requireApiKey(): string {
  const key = process.env.E2B_API_KEY;
  if (!key) {
    throw new Error(
      "E2B_API_KEY ist nicht gesetzt — fuer E2B muss ein Key von e2b.dev hinterlegt werden.",
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

async function executeHostCommand(command: string, timeoutSeconds: number): Promise<string> {
  if ((process.env.LUKAS_HOST_EXECUTOR_ENABLED ?? "").trim().toLowerCase() !== "true") {
    throw new Error(
      "Host-Executor ist deaktiviert. LUKAS_HOST_EXECUTOR_ENABLED=true muss gesetzt sein.",
    );
  }

  const timeoutMs = Math.min(Math.max(timeoutSeconds, 1), 280) * 1000;
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

  return await new Promise<string>((resolve, reject) => {
    const child = spawn("nsenter", args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        HOME: "/root",
        USER: "root",
        LOGNAME: "root",
        SHELL: "/bin/bash",
        LANG: "C.UTF-8",
        TERM: process.env.TERM ?? "xterm-256color",
      },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk);
    });

    const terminate = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // Prozess ist bereits beendet.
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

export async function executeCommand(
  conversationId: number,
  command: string,
  timeoutSeconds = 60,
): Promise<string> {
  if (!command.trim()) throw new Error("command darf nicht leer sein");

  if (executionBackend() === "host") {
    return executeHostCommand(command, timeoutSeconds);
  }
  return executeE2bCommand(conversationId, command, timeoutSeconds);
}

export function resetSandbox(conversationId: number): string {
  if (executionBackend() === "host") {
    return "Host-Modus aktiv: Der VPS ist dauerhaft und wird nicht zurueckgesetzt.";
  }

  const cached = sandboxes.get(conversationId);
  if (cached) {
    cached.sandbox.kill().catch(() => {});
    sandboxes.delete(conversationId);
  }
  return "Sandbox zurueckgesetzt — der naechste Befehl startet eine frische Umgebung.";
}
