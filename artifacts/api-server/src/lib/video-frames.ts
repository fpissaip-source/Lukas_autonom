import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

/*
 * Videos in Einzelbilder zerlegen, damit Lukas sie trotzdem "ansehen" kann.
 *
 * Hintergrund: die Chat-Completions-API hat keinen Video-Input — aber sie hat
 * Bild-Input. Statt ein Video also als "nicht auswertbar" abzulehnen, ziehen
 * wir gleichmaessig verteilte Frames heraus und schicken die als Bilder mit.
 * Das ist der uebliche Weg und deckt genau das ab, was man bei einem kurzen
 * Clip wissen will (was ist zu sehen, was passiert grob).
 *
 * Grenzen, die dabei ehrlich bleiben muessen: Ton wird NICHT ausgewertet, und
 * zwischen zwei Frames kann etwas passieren, das niemand sieht. Der Aufrufer
 * teilt dem Modell darum mit, dass es Standbilder sieht, kein Video.
 */

const MAX_FRAMES = 8;
const FRAME_WIDTH = 768; // reicht fuer Vision, haelt die Tokenkosten im Rahmen

export type VideoFramesResult =
  | { ok: true; frames: string[]; durationSeconds: number | null } // Base64-JPEGs
  | { ok: false; reason: string };

/*
 * Wo liegt ffmpeg?
 *
 * 'ffmpeg-static' exportiert keinen Code, sondern nur einen Pfad, den es aus
 * __dirname zusammenbaut. Im Build buendelt esbuild dieses Modul mit ein, und
 * __dirname zeigt danach auf dist/ statt auf node_modules/ffmpeg-static/ --
 * der Pfad zeigt also ins Leere, waehrend er lokal (ungebuendelt) stimmt.
 * Genau deshalb hat die Frame-Extraktion in der Produktion still versagt und
 * lokal funktioniert.
 *
 * build.mjs haelt 'ffmpeg-static' jetzt extern, damit der Pfad wieder stimmt.
 * Trotzdem wird hier geprueft statt vertraut, und es gibt zwei Auswege:
 * FFMPEG_BIN als expliziter Override und ein ffmpeg aus dem PATH. Eine falsche
 * Build-Einstellung soll Lukas nie wieder blind machen.
 */
let cachedBinary: string | null | undefined;

function findOnPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveFfmpeg(): string | null {
  if (cachedBinary !== undefined) return cachedBinary;

  for (const candidate of [process.env.FFMPEG_BIN?.trim(), ffmpegPath]) {
    if (candidate && existsSync(candidate)) {
      cachedBinary = candidate;
      logger.info({ ffmpeg: candidate }, "ffmpeg gefunden");
      return cachedBinary;
    }
  }

  cachedBinary = findOnPath("ffmpeg");
  if (cachedBinary) logger.info({ ffmpeg: cachedBinary }, "ffmpeg aus PATH");
  else logger.error({ ffmpegStaticPath: ffmpegPath }, "ffmpeg nirgends gefunden");
  return cachedBinary;
}

async function probeDuration(binary: string, file: string): Promise<number | null> {
  // ffprobe ist in ffmpeg-static nicht enthalten — Dauer daher aus der
  // ffmpeg-Ausgabe lesen. ffmpeg beendet sich hier mit Fehlercode (kein
  // Output angegeben), das ist erwartet und kein Problem.
  try {
    await execFileAsync(binary, ["-i", file], { timeout: 20000 });
    return null;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
}

export async function extractVideoFrames(
  videoBase64: string,
  filename: string,
): Promise<VideoFramesResult> {
  const binary = resolveFfmpeg();
  if (!binary) {
    return {
      ok: false,
      reason:
        "ffmpeg ist auf dem Server nicht auffindbar (weder über ffmpeg-static, " +
        "noch über FFMPEG_BIN, noch im PATH). Ohne ffmpeg lässt sich kein Video " +
        "in Einzelbilder zerlegen.",
    };
  }

  const dir = await mkdtemp(path.join(tmpdir(), "lukas-video-"));
  const ext = path.extname(filename) || ".mp4";
  const input = path.join(dir, `in${ext}`);

  try {
    await writeFile(input, Buffer.from(videoBase64, "base64"));
    const duration = await probeDuration(binary, input);

    // Gleichmaessig ueber die Laufzeit verteilen. Ohne bekannte Dauer (z.B.
    // kaputte Metadaten) auf 1 Frame/Sekunde zurueckfallen und hart deckeln.
    const fps =
      duration && duration > 0
        ? Math.min(MAX_FRAMES / duration, 4)
        : 1;

    await execFileAsync(
      binary,
      [
        "-i", input,
        "-vf", `fps=${fps.toFixed(4)},scale=${FRAME_WIDTH}:-2`,
        "-frames:v", String(MAX_FRAMES),
        "-q:v", "4",
        path.join(dir, "frame-%02d.jpg"),
      ],
      { timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
    );

    const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
    const frames: string[] = [];
    for (const f of files.slice(0, MAX_FRAMES)) {
      frames.push((await readFile(path.join(dir, f))).toString("base64"));
    }
    if (frames.length === 0) {
      return {
        ok: false,
        reason: `ffmpeg lief durch, hat aus "${filename}" aber kein einziges Bild erzeugt — die Datei enthält vermutlich keine auswertbare Videospur.`,
      };
    }
    return { ok: true, frames, durationSeconds: duration };
  } catch (err) {
    // Der Grund muss nach oben durchgereicht werden. Vorher landete er nur im
    // Log, und Lukas musste im Chat raten, warum er nichts sieht.
    const stderr = (err as { stderr?: string }).stderr ?? "";
    const detail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400);
    logger.warn({ err, filename, binary }, "Video-Frame-Extraktion fehlgeschlagen");
    return {
      ok: false,
      reason:
        `ffmpeg (${binary}) ist beim Zerlegen von "${filename}" gescheitert: ` +
        (detail || (err as Error).message),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
