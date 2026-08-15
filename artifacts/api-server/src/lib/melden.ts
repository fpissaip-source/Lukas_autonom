import { db } from "@workspace/db";
import { meldungen, type Meldung } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "./logger";

/*
 * Was Lukas von Issa braucht.
 *
 * Im autonomen Lauf arbeitet er allein. Braucht er dabei etwas, das nur Issa
 * geben kann — eine Entscheidung, einen Zugang, eine Antwort —, stand er
 * bisher still, bis Issa zufaellig nachsah.
 *
 * Der erste Versuch schrieb das in den Chat und schickte es aufs Handy. Beides
 * war falsch. Im Chat geht eine Meldung zwischen den Nachrichten unter, und man
 * sieht nicht, was noch offen ist; WhatsApp ist eine Unterbrechung, die Issa so
 * nicht wollte.
 *
 * Deshalb ein eigener Ort mit einem Zustand: eine Meldung ist OFFEN, bis Issa
 * geantwortet hat. Im Dashboard steht die Zahl der offenen daneben — damit
 * sieht man auf einen Blick, ob Lukas gerade auf etwas wartet.
 */

/*
 * Nicht zweimal dasselbe.
 *
 * Der autonome Lauf startet alle 30 Minuten neu. Ohne Sperre landet dieselbe
 * offene Frage bei jedem Durchlauf erneut im Tab — nach einem Tag waeren das
 * 48 identische Eintraege, und danach liest sie niemand mehr.
 *
 * Die Sperre haengt hier NICHT am Speicher, sondern an der offenen Meldung
 * selbst: solange eine mit demselben Betreff offen ist, kommt keine zweite
 * dazu. Das ueberlebt auch einen Neustart, und es ist die ehrlichere Regel —
 * es geht ja darum, dass die Frage noch unbeantwortet ist.
 */
async function bereitsOffen(betreff: string): Promise<Meldung | undefined> {
  const [vorhanden] = await db
    .select()
    .from(meldungen)
    .where(and(eq(meldungen.betreff, betreff), eq(meldungen.status, "offen")))
    .limit(1);
  return vorhanden;
}

export async function meldeDichBeiIssa(opts: {
  betreff: string;
  text: string;
  dringend?: boolean;
}): Promise<string> {
  const betreff = opts.betreff.trim();
  const text = opts.text.trim();
  if (!betreff || !text) {
    throw new Error("Ohne Betreff und Text weiss Issa nicht, worum es geht.");
  }

  const offen = await bereitsOffen(betreff);
  if (offen) {
    return (
      `Das liegt bei Issa schon offen ("${betreff}", seit ` +
      `${offen.createdAt.toLocaleString("de-DE")}). Er hat es also — warte auf seine Antwort ` +
      `und arbeite in der Zwischenzeit an etwas anderem weiter. Noch einmal zu fragen bringt ` +
      `nichts und geht ihm auf die Nerven.`
    );
  }

  const [row] = await db
    .insert(meldungen)
    .values({ betreff, text, dringend: opts.dringend === true })
    .returning();

  logger.info({ id: row.id, betreff }, "Lukas hat sich bei Issa gemeldet");

  return (
    `Deine Meldung "${betreff}" liegt jetzt im Dashboard unter "Meldungen" und wartet auf Issa. ` +
    `Bleib nicht stehen: arbeite an etwas anderem weiter. Seine Antwort bekommst du beim ` +
    `nächsten Lauf vorgelegt.`
  );
}

export async function listeMeldungen(): Promise<Meldung[]> {
  return db.select().from(meldungen).orderBy(desc(meldungen.createdAt)).limit(200);
}

export async function offeneAnzahl(): Promise<number> {
  const rows = await db.select().from(meldungen).where(eq(meldungen.status, "offen"));
  return rows.length;
}

/** Issa antwortet. Damit ist die Meldung erledigt — die Antwort geht an Lukas. */
export async function beantworteMeldung(id: number, antwort: string): Promise<Meldung> {
  const [row] = await db
    .update(meldungen)
    .set({
      status: "erledigt",
      antwort: antwort.trim() || null,
      // gelesen bleibt false: Lukas hat die Antwort noch nicht gesehen.
      gelesen: false,
      erledigtAt: new Date(),
    })
    .where(eq(meldungen.id, id))
    .returning();
  if (!row) throw new Error(`Meldung ${id} existiert nicht.`);
  logger.info({ id }, "Meldung beantwortet");
  return row;
}

/*
 * Antworten, die Lukas noch nicht kennt — und sie danach als gesehen markieren.
 *
 * Ohne diesen Weg waere der Tab eine Sackgasse: Lukas fragt, Issa antwortet,
 * und die Antwort kommt nie an. Genau das ist der Unterschied zwischen einem
 * Postfach und einem Beschwerdekasten.
 */
export async function neueAntworten(): Promise<string> {
  const rows = await db
    .select()
    .from(meldungen)
    .where(and(eq(meldungen.status, "erledigt"), eq(meldungen.gelesen, false)))
    .orderBy(desc(meldungen.erledigtAt))
    .limit(10);

  if (rows.length === 0) return "";

  for (const r of rows) {
    await db.update(meldungen).set({ gelesen: true }).where(eq(meldungen.id, r.id));
  }

  return (
    `\n\nISSA HAT AUF DEINE MELDUNGEN GEANTWORTET:\n` +
    rows
      .map(
        (r) =>
          `- "${r.betreff}"\n  Deine Frage: ${r.text.slice(0, 300)}\n` +
          `  Seine Antwort: ${r.antwort?.trim() || "(ohne Text abgehakt)"}`,
      )
      .join("\n") +
    `\nDas ist der Grund, warum du gewartet hast — nimm die Sache jetzt wieder auf.`
  );
}
