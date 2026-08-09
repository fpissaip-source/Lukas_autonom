import { Client } from "ssh2";
import { logger } from "./logger";

/*
 * Lukas' Ausführungsumgebung: ein Docker-Container auf Issas eigenem
 * DigitalOcean-Droplet. Kein Fremdanbieter (E2B wurde dafür abgelöst), keine
 * Zusatzkosten.
 *
 * Warum Docker und nicht direkt auf dem Droplet:
 * Auf dem Droplet laufen die Trading-Bots, die Postgres-DB und die Wallet-/
 * API-Credentials. Lukas liest E-Mails und Webseiten — also Inhalte, die
 * Fremde schreiben. Bekäme er eine Shell direkt auf dem Host, würde eine
 * präparierte Mail genügen, um an all das heranzukommen. Der Container hat
 * root, volles Internet und keinen Befehlsfilter — aber er sieht weder das
 * Dateisystem des Hosts noch dessen Secrets noch den Docker-Socket.
 *
 * Benötigte Variablen:
 *   VPS_SSH_HOST         IP des Droplets
 *   VPS_SSH_USER         SSH-Benutzer (Standard: root)
 *   VPS_SSH_KEY          privater SSH-Schlüssel (kompletter PEM-Inhalt)
 *   VPS_SSH_PORT         optional, Standard 22
 *   LUKAS_SANDBOX_IMAGE  optional, Standard python:3.12-slim
 */

const IDLE_MS = 15 * 60 * 1000;
const MAX_OUTPUT = 12000;
const DEFAULT_IMAGE = process.env.LUKAS_SANDBOX_IMAGE ?? "python:3.12-slim";

function requireSshConfig(): { host: string; user: string; key: string; port: number } {
  const host = process.env.VPS_SSH_HOST;
  const key = process.env.VPS_SSH_KEY;
  if (!host || !key) {
    throw new Error(
      "VPS_SSH_HOST/VPS_SSH_KEY sind nicht gesetzt — ohne SSH-Zugang zum Droplet kann ich nichts ausführen.",
    );
  }
  return {
    host,
    user: process.env.VPS_SSH_USER ?? "root",
    key,
    port: Number(process.env.VPS_SSH_PORT ?? 22),
  };
}

/** Führt einen Befehl per SSH auf dem Droplet aus (Host-Ebene, nicht im Container). */
function sshExec(
  command: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cfg = requireSshConfig();
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch { /* Verbindung ggf. schon zu */ }
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error(`Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)}s`))),
      timeoutMs + 5000,
    );

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) return finish(() => { clearTimeout(timer); reject(err); });
          let stdout = "";
          let stderr = "";
          stream
            .on("close", (code: number) => {
              clearTimeout(timer);
              finish(() => resolve({ stdout, stderr, code: code ?? 0 }));
            })
            .on("data", (d: Buffer) => { stdout += d.toString(); })
            .stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        });
      })
      .on("error", (err) => { clearTimeout(timer); finish(() => reject(err)); })
      .connect({ host: cfg.host, port: cfg.port, username: cfg.user, privateKey: cfg.key });
  });
}

/** Ein Container pro Konversation, damit Dateien/Pakete im Gespräch erhalten bleiben. */
function containerName(conversationId: number): string {
  return `lukas-sandbox-${conversationId}`;
}

/** In einfache Anführungszeichen für die Shell verpacken. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function ensureContainer(conversationId: number): Promise<string> {
  const name = containerName(conversationId);

  const running = await sshExec(
    `docker ps --filter name=^/${name}$ --format '{{.Names}}'`,
    20000,
  );
  if (running.stdout.trim() === name) return name;

  // Reste eines beendeten Containers gleichen Namens entfernen
  await sshExec(`docker rm -f ${name} 2>/dev/null || true`, 20000);

  /*
   * Die Isolationsentscheidungen, jede mit Grund:
   *  --network bridge          Internet ja (Issas Wunsch), aber kein Host-Netz
   *  --memory / --cpus         ein Amoklauf legt das Droplet nicht lahm
   *  --pids-limit              Fork-Bomben laufen ins Leere
   *  KEIN -v                   kein Host-Dateisystem, keine .env, kein Docker-Socket
   *  KEIN --env                keine Host-Variablen, also keine Secrets
   *  --label                   damit der Cleanup sie wiederfindet
   *  sleep infinity            Container bleibt für docker exec am Leben
   */
  const create = await sshExec(
    [
      "docker run -d",
      `--name ${name}`,
      "--label lukas-sandbox=1",
      "--network bridge",
      "--memory 2g --memory-swap 2g --cpus 1.5 --pids-limit 512",
      "--workdir /work",
      DEFAULT_IMAGE,
      "sleep infinity",
    ].join(" "),
    90000,
  );
  if (create.code !== 0) {
    throw new Error(`Container konnte nicht gestartet werden: ${create.stderr.slice(0, 300)}`);
  }
  return name;
}

export async function executeCommand(
  conversationId: number,
  command: string,
  timeoutSeconds = 60,
): Promise<string> {
  const timeout = Math.min(Math.max(timeoutSeconds, 1), 280);
  const name = await ensureContainer(conversationId);

  const result = await sshExec(
    `docker exec ${name} timeout ${timeout} sh -lc ${shQuote(command)}`,
    timeout * 1000,
  );

  const parts: string[] = [];
  if (result.stdout) parts.push(`STDOUT:\n${result.stdout}`);
  if (result.stderr) parts.push(`STDERR:\n${result.stderr}`);
  if (result.code === 124) parts.push(`(Abgebrochen: Zeitlimit von ${timeout}s erreicht)`);
  parts.push(`EXIT CODE: ${result.code}`);

  const out = parts.join("\n\n");
  return out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + "\n\n[... gekürzt]" : out;
}

/*
 * Befehl DIREKT auf dem Droplet ausführen — nicht im Container.
 *
 * Damit kann Lukas Dinge tun, die den Host betreffen: Hermes installieren,
 * Dienste einrichten, Systempakete nachziehen. Das ist echte Host-Macht: von
 * hier aus sind die Trading-Credentials, die Datenbank und die laufenden Bots
 * erreichbar.
 *
 * Deshalb ist der zugehörige Tool-Aufruf als R3 eingestuft und braucht Issas
 * Freigabe für JEDEN einzelnen Befehl, gebunden an genau diesen Wortlaut. Die
 * Absicherung liegt bewusst nicht hier, sondern in lib/policy.ts — diese
 * Funktion führt nur aus, was dort bereits genehmigt wurde.
 */
export async function executeOnHost(command: string, timeoutSeconds = 120): Promise<string> {
  const timeout = Math.min(Math.max(timeoutSeconds, 1), 600);
  const result = await sshExec(`timeout ${timeout} sh -lc ${shQuote(command)}`, timeout * 1000);

  const parts: string[] = [];
  if (result.stdout) parts.push(`STDOUT:\n${result.stdout}`);
  if (result.stderr) parts.push(`STDERR:\n${result.stderr}`);
  if (result.code === 124) parts.push(`(Abgebrochen: Zeitlimit von ${timeout}s erreicht)`);
  parts.push(`EXIT CODE: ${result.code}`);

  const out = parts.join("\n\n");
  return out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + "\n\n[... gekürzt]" : out;
}

export async function resetSandbox(conversationId: number): Promise<string> {
  const name = containerName(conversationId);
  await sshExec(`docker rm -f ${name} 2>/dev/null || true`, 30000);
  return "Sandbox zurückgesetzt — der nächste Befehl startet eine frische Umgebung.";
}

/*
 * Verwaiste Container aufräumen. Ohne das sammeln sich Container auf dem
 * Droplet an, bis der Speicher voll ist — jede Konversation legt einen an.
 */
export async function cleanupIdleSandboxes(): Promise<void> {
  try {
    const list = await sshExec(
      `docker ps -q --filter label=lukas-sandbox=1 --filter "status=running"`,
      30000,
    );
    const ids = list.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return;

    const cutoff = Date.now() - IDLE_MS;
    for (const id of ids) {
      const started = await sshExec(`docker inspect -f '{{.State.StartedAt}}' ${id}`, 20000);
      const startedAt = Date.parse(started.stdout.trim());
      if (Number.isFinite(startedAt) && startedAt < cutoff) {
        await sshExec(`docker rm -f ${id}`, 30000);
        logger.info({ id }, "Verwaiste Lukas-Sandbox entfernt");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Sandbox-Cleanup fehlgeschlagen");
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startSandboxCleanup(): void {
  if (!process.env.VPS_SSH_HOST || !process.env.VPS_SSH_KEY) return;
  cleanupTimer = setInterval(() => {
    cleanupIdleSandboxes().catch(() => {});
  }, 10 * 60 * 1000);
  logger.info("Sandbox-Cleanup gestartet (alle 10 Minuten)");
}

export function stopSandboxCleanup(): void {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
}
