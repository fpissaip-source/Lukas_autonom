/*
 * Dieselbe Aktion mit Aussenwirkung nicht zweimal ausfuehren.
 *
 * DER ABLAUF, gegen den das steht: die Mail geht raus, danach bricht die
 * Verbindung weg, der Werkzeugaufruf sieht aus wie gescheitert, der Agent
 * versucht es erneut. Der Empfaenger bekommt sie doppelt — und zurueckholen
 * laesst sich nichts.
 *
 * DER MECHANISMUS ist der eindeutige Index, nicht eine Abfrage. Der
 * Einfuegeversuch IST die Reservierung: zwei gleichzeitige Zuege koennen
 * nicht beide gewinnen, einer bekommt den Konfliktfehler. Ein "erst
 * nachsehen, dann schreiben" haette genau dieses Rennen verloren — und
 * gleichzeitige Aufrufe sind bei einem Agenten der Normalfall, nicht der
 * Sonderfall.
 *
 * DAS FENSTER ist die eigentliche Abwaegung. Zu kurz und der Schutz greift
 * nicht; zu lang und dieselbe Mail laesst sich am selben Tag nicht zweimal
 * schicken, obwohl das gewollt sein kann. Zehn Minuten decken jeden
 * Wiederholungsversuch ab, den ein Zug erzeugt.
 *
 * WOFUER NICHT: SMS. Dort steckt derselbe Schutz bereits in der
 * Nachrichtentabelle, weil jede Zeile ohnehin vor dem Versand entsteht. Das
 * darauf umzubauen haette einen geprueften Pfad angefasst, ohne etwas zu
 * gewinnen.
 */
import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { versandTable } from "@workspace/db";
import { and, eq, gte } from "drizzle-orm";
import { logger } from "./logger";

const FENSTER_MS = Number(process.env.LUKAS_VERSAND_FENSTER_MS ?? 10 * 60 * 1000);

export function fingerabdruck(...teile: unknown[]): string {
  return createHash("sha256").update(teile.map(String).join(" ")).digest("hex").slice(0, 32);
}

export type VersandErgebnis<T> = { wiederholung: boolean; ergebnis: T | string };

/**
 * Fuehrt `arbeit` genau einmal je Fingerabdruck und Zeitfenster aus.
 *
 * Bei einer Wiederholung kommt zurueck, was beim ersten Mal herauskam — und
 * zwar mit `wiederholung: true`, damit der Aufrufer es benennen kann. Ein
 * stilles "hat geklappt" waere schlechter: Lukas wuerde denken, er habe
 * gerade etwas getan, das in Wahrheit schon vor Minuten passiert ist.
 */
export async function nurEinmal<T>(
  art: string,
  schluessel: string,
  arbeit: () => Promise<T>,
): Promise<VersandErgebnis<T>> {
  const seit = new Date(Date.now() - FENSTER_MS);

  // Gab es das eben schon?
  try {
    const [vorhanden] = await db
      .select()
      .from(versandTable)
      .where(
        and(
          eq(versandTable.art, art),
          eq(versandTable.fingerabdruck, schluessel),
          gte(versandTable.createdAt, seit),
        ),
      )
      .limit(1);

    if (vorhanden) {
      logger.info({ art, schluessel }, "Dieselbe Aktion lief vor Kurzem schon — nicht wiederholt");
      return { wiederholung: true, ergebnis: vorhanden.ergebnis };
    }
  } catch (err) {
    /*
     * Ohne Datenbank wird AUSGEFUEHRT, nicht blockiert.
     *
     * Die Abwaegung: eine doppelte Mail ist aergerlich, eine Mail, die wegen
     * einer Datenbankstoerung gar nicht rausgeht, obwohl Issa sie freigegeben
     * hat, ist schlimmer. Der Schutz ist eine Verbesserung, keine Bedingung.
     */
    logger.warn({ err, art }, "Versandsperre nicht lesbar — Aktion läuft ohne sie");
    return { wiederholung: false, ergebnis: await arbeit() };
  }

  /*
   * Reservieren, BEVOR gearbeitet wird. Faellt der Prozess mitten im Versand,
   * steht die Zeile trotzdem — und der naechste Versuch schickt nicht noch
   * einmal. Lieber eine Mail, die vielleicht nicht ankam, als zwei, die
   * ankamen.
   */
  try {
    await db
      .insert(versandTable)
      .values({ art, fingerabdruck: schluessel, ergebnis: "", erledigt: false });
  } catch {
    // Der eindeutige Index hat zugeschlagen: ein anderer Zug war schneller.
    logger.info({ art, schluessel }, "Ein gleichzeitiger Aufruf war schneller — nicht wiederholt");
    return { wiederholung: true, ergebnis: "" };
  }

  const ergebnis = await arbeit();

  await db
    .update(versandTable)
    .set({ ergebnis: typeof ergebnis === "string" ? ergebnis.slice(0, 2000) : "", erledigt: true })
    .where(and(eq(versandTable.art, art), eq(versandTable.fingerabdruck, schluessel)))
    .catch(() => {});

  return { wiederholung: false, ergebnis };
}
