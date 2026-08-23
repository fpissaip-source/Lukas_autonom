import { db } from "@workspace/db";
import { goalsTable, approvals, meldungen, debugLogTable } from "@workspace/db";
import { eq, inArray, gte } from "drizzle-orm";
import { logger } from "./logger";

/*
 * Muss dieser autonome Lauf ueberhaupt stattfinden?
 *
 * Bisher lief er stur alle 30 Minuten, sobald irgendein Ziel aktiv war — bis
 * zu 48 volle Agentenlaeufe am Tag, jeder mit Seele, Werkzeugen, Erinnerungen
 * und mehreren Runden. Ein grosser Teil davon lief in eine Welt hinein, in der
 * sich seit dem letzten Lauf nichts geaendert hatte: dieselben Ziele, derselbe
 * Stand, dieselben offenen Freigaben. Das kostet jedes Mal denselben Prompt.
 *
 * Hier wird deshalb VOR dem teuren Lauf nachgesehen, ob sich etwas bewegt hat.
 * Die Pruefung selbst sind vier kleine Datenbankabfragen und kostet kein
 * einziges Token.
 *
 * Ausdruecklich KEINE Einschraenkung seiner Autonomie: hat sich nichts bewegt,
 * arbeitet er trotzdem weiter — nur in ruhigerem Takt (Grundtakt, Standard
 * drei Stunden). Passiert etwas, ist er beim naechsten Herzschlag da.
 *
 * Wichtig ist der Zeitpunkt der Momentaufnahme: sie wird NACH dem Lauf
 * genommen. Denn ein Lauf aendert selbst Ziele und schreibt Tagebuch — nimmt
 * man sie davor, loest jeder Lauf den naechsten aus, und man ist wieder bei
 * 48 am Tag.
 */

let letzterLauf = 0;
let letzterStand: string | null = null;

/** Nur fuer Tests. */
export function anlassZuruecksetzen(): void {
  letzterLauf = 0;
  letzterStand = null;
}

function minuten(name: string, standard: number): number {
  const wert = Number(process.env[name] ?? standard);
  return Number.isFinite(wert) && wert > 0 ? wert : standard;
}

/**
 * Ein Fingerabdruck dessen, was Lukas' Arbeit beeinflusst. Aendert er sich,
 * ist etwas passiert, das einen Lauf verdient.
 */
async function weltbild(): Promise<{ signatur: string; teile: Record<string, string> }> {
  const [ziele, freigaben, meldungenRows] = await Promise.all([
    db.select().from(goalsTable).where(eq(goalsTable.status, "active")),
    db.select().from(approvals).where(inArray(approvals.status, ["pending", "allowed"])),
    db.select().from(meldungen).where(eq(meldungen.status, "erledigt")),
  ]);

  const teile = {
    ziele: (ziele as any[])
      .map((g) => `${g.id}:${g.progress}:${new Date(g.updatedAt).getTime()}`)
      .sort()
      .join("|"),
    freigaben: (freigaben as any[])
      .map((a) => `${a.id}:${a.status}`)
      .sort()
      .join("|"),
    // Beantwortete, aber von Lukas noch nicht gelesene Meldungen: genau darauf
    // hat er gewartet.
    antworten: (meldungenRows as any[])
      .filter((m) => m.antwort && !m.gelesen)
      .map((m) => String(m.id))
      .sort()
      .join("|"),
  };

  return { signatur: JSON.stringify(teile), teile };
}

/** Haeufen sich seit dem letzten Lauf Fehler? Drei sind kein Ausrutscher mehr. */
async function neueFehler(seit: Date): Promise<number> {
  const zeilen = await db.select().from(debugLogTable).where(gte(debugLogTable.createdAt, seit));
  return (zeilen as any[]).length;
}

export async function anlass(): Promise<{ starten: boolean; grund: string }> {
  const jetzt = Date.now();
  const grundtakt = minuten("LUKAS_AUTONOMY_MIN_PAUSE_MIN", 180) * 60 * 1000;

  const { signatur } = await weltbild();

  // Erster Lauf nach dem Start: immer. Der Serverneustart ist selbst ein
  // Ereignis, und ohne diesen Fall wuerde Lukas nach einem Deploy drei Stunden
  // schweigen.
  if (letzterStand === null) {
    return { starten: true, grund: "erster Lauf nach dem Start" };
  }

  if (signatur !== letzterStand) {
    return { starten: true, grund: "es hat sich etwas bewegt (Ziele, Freigaben oder eine Antwort von Issa)" };
  }

  const fehler = await neueFehler(new Date(letzterLauf));
  if (fehler >= 3) {
    return { starten: true, grund: `${fehler} neue Fehler seit dem letzten Lauf` };
  }

  if (jetzt - letzterLauf >= grundtakt) {
    return { starten: true, grund: "Grundtakt — auch ohne Anlass wird weitergearbeitet" };
  }

  const restMinuten = Math.ceil((grundtakt - (jetzt - letzterLauf)) / 60000);
  return {
    starten: false,
    grund: `nichts bewegt, nächster Grundtakt in ${restMinuten} min`,
  };
}

/**
 * Nach dem Lauf aufrufen — nicht davor. Siehe Kopf der Datei: sonst loest
 * jeder Lauf den naechsten aus.
 */
export async function laufNotiert(): Promise<void> {
  letzterLauf = Date.now();
  try {
    letzterStand = (await weltbild()).signatur;
  } catch (err) {
    // Lieber einmal zu viel laufen als nie wieder: bleibt der Stand leer,
    // startet der naechste Durchgang regulaer.
    logger.warn({ err }, "Weltbild nach dem Lauf nicht lesbar");
    letzterStand = null;
  }
}
