import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
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

export type VideoFrames = {
  frames: string[]; // Base64-JPEGs
  durationSeconds: number | null;
};

async function probeDuration(file: string): Promise<number | null> {
  // ffprobe ist in ffmpeg-static nicht enthalten — Dauer daher aus der
  // ffmpeg-Ausgabe lesen. ffmpeg beendet sich hier mit Fehlercode (kein
  // Output angegeben), das ist erwartet und kein Problem.
  try {
    await execFileAsync(ffmpegPath as string, ["-i", file], { timeout: 20000 });
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
): Promise<VideoFrames | null> {
  if (!ffmpegPath) {
    logger.warn("ffmpeg-static nicht verfügbar — Video-Frames übersprungen");
    return null;
  }

  const dir = await mkdtemp(path.join(tmpdir(), "lukas-video-"));
  const ext = path.extname(filename) || ".mp4";
  const input = path.join(dir, `in${ext}`);

  try {
    await writeFile(input, Buffer.from(videoBase64, "base64"));
    const duration = await probeDuration(input);

    // Gleichmaessig ueber die Laufzeit verteilen. Ohne bekannte Dauer (z.B.
    // kaputte Metadaten) auf 1 Frame/Sekunde zurueckfallen und hart deckeln.
    const fps =
      duration && duration > 0
        ? Math.min(MAX_FRAMES / duration, 4)
        : 1;

    await execFileAsync(
      ffmpegPath as string,
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
    if (frames.length === 0) return null;
    return { frames, durationSeconds: duration };
  } catch (err) {
    logger.warn({ err, filename }, "Video-Frame-Extraktion fehlgeschlagen");
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
