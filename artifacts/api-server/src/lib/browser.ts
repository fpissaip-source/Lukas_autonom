import { sshExec, shQuote } from "./code-sandbox";
import { BROWSER_SCRIPT } from "./browser-script";
import { logger } from "./logger";

/*
 * Ein echter Browser fuer Lukas.
 *
 * fetch_url holt nur das rohe HTML. Bei Higgsfield — und bei so ziemlich jeder
 * modernen Seite — ist das eine leere Huelle: der Inhalt entsteht erst im
 * Browser. Lukas hat deshalb wahrheitsgemaess gemeldet, er sehe die Prompts und
 * Assets nicht. Er konnte sie nicht sehen.
 *
 * WO das laeuft: in einem eigenen Container auf Issas Droplet, nicht auf
 * Railway. Zwei Gruende. Erstens ist dort ohnehin schon die Ausfuehrungsumgebung
 * mit SSH-Zugang; ein Browser auf Railway waere ein zweiter Ort mit eigener
 * Installation. Zweitens ist ein Browser, der fremde Seiten oeffnet, genau die
 * Sorte Programm, die man nicht neben dem eigenen Server laufen laesst.
 *
 * Der Container ist langlebig und wird NICHT vom Idle-Cleanup erfasst (anderes
 * Label): die Erstinstallation dauert einige Minuten, die will man nicht alle
 * 15 Minuten erneut bezahlen.
 */

const CONTAINER = "lukas-browser";
const IMAGE = process.env.LUKAS_BROWSER_IMAGE ?? "node:22-bookworm-slim";
const NETWORK = "lukas-sandbox";

/** Ist der Container da und einsatzbereit? */
async function laeuft(): Promise<boolean> {
  const r = await sshExec(`docker ps --filter name=^/${CONTAINER}$ --format '{{.Names}}'`, 20000);
  return r.stdout.trim() === CONTAINER;
}

/*
 * Beim allerersten Mal wird installiert: playwright plus Chromium samt
 * Systempaketen. Das dauert und darf deshalb grosszuegig Zeit bekommen.
 *
 * Bewusst kein fertiges Playwright-Image: dessen Tag muss zur installierten
 * Playwright-Version passen, und eine falsch geratene Version scheitert erst
 * beim ersten Aufruf. `npx playwright install` holt genau den Browser, der zur
 * gerade installierten Bibliothek gehoert — da kann nichts auseinanderlaufen.
 */
async function starteContainer(): Promise<void> {
  await sshExec(`docker network create ${NETWORK} 2>/dev/null || true`, 30000);
  await sshExec(`docker rm -f ${CONTAINER} 2>/dev/null || true`, 30000);

  const start = await sshExec(
    [
      "docker run -d",
      `--name ${CONTAINER}`,
      "--label lukas-browser=1",
      `--network ${NETWORK}`,
      // Chromium braucht mehr als die Sandbox: eigene Prozesse pro Tab,
      // und /dev/shm ist im Standard viel zu klein fuer eine Renderengine.
      "--shm-size 1g",
      "--memory 3g --memory-swap 3g --cpus 2 --pids-limit 2048",
      "--security-opt no-new-privileges:true",
      "--workdir /browser",
      IMAGE,
      "sleep infinity",
    ].join(" "),
    120000,
  );
  if (start.code !== 0) {
    throw new Error(`Browser-Container startet nicht: ${start.stderr.slice(0, 300)}`);
  }

  logger.info("Browser wird im Container eingerichtet — das dauert beim ersten Mal einige Minuten");
  const setup = await sshExec(
    `docker exec ${CONTAINER} sh -lc ${shQuote(
      "mkdir -p /browser && cd /browser && npm init -y >/dev/null 2>&1 && " +
        "npm i playwright@1.49.1 >/dev/null 2>&1 && npx playwright install --with-deps chromium",
    )}`,
    600000,
  );
  if (setup.code !== 0) {
    await sshExec(`docker rm -f ${CONTAINER} 2>/dev/null || true`, 30000);
    throw new Error(`Browser-Installation fehlgeschlagen: ${setup.stderr.slice(0, 500)}`);
  }
}

/** Container da? Sonst einrichten. Danach ist er bis auf Weiteres warm. */
export async function ensureBrowser(): Promise<void> {
  if (await laeuft()) return;
  await starteContainer();
}

export type BrowseErgebnis = {
  ok: boolean;
  fehler?: string;
  status?: number | null;
  url?: string;
  titel?: string;
  text?: string;
  links?: string[];
  medien?: string[];
  mehrGeklickt?: number;
};

/**
 * Eine Seite wirklich oeffnen: warten bis sie gebaut ist, scrollen, "Mehr
 * laden" druecken, und dann Text, Links und Medien herausgeben.
 */
export async function renderPage(url: string, scrolls = 12): Promise<BrowseErgebnis> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Nur http/https URLs sind erlaubt");
  }
  await ensureBrowser();

  // Skript bei jedem Aufruf frisch hineinschreiben: so gilt immer die Fassung
  // aus diesem Repo, auch wenn der Container aus einem alten Deploy stammt.
  const schreiben = await sshExec(
    `docker exec -i ${CONTAINER} sh -lc ${shQuote("cat > /browser/browse.cjs")}`,
    60000,
    BROWSER_SCRIPT,
  );
  if (schreiben.code !== 0) {
    throw new Error(`Browser-Skript liess sich nicht ablegen: ${schreiben.stderr.slice(0, 300)}`);
  }

  const lauf = await sshExec(
    `docker exec ${CONTAINER} sh -lc ${shQuote(
      `cd /browser && node browse.cjs ${shQuote(url)} ${Number(scrolls) || 12}`,
    )}`,
    180000,
  );

  const zeile = lauf.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  try {
    return JSON.parse(zeile) as BrowseErgebnis;
  } catch {
    return {
      ok: false,
      fehler:
        `Der Browser hat nichts Lesbares zurueckgegeben (Exit ${lauf.code}).\n` +
        `${lauf.stderr.slice(0, 500)}`,
    };
  }
}
