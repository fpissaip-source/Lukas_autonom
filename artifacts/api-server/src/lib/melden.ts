import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import { whatsappConfigured, sendWhatsAppMessage } from "./whatsapp";

/*
 * Lukas meldet sich bei Issa.
 *
 * Bisher lief die Kommunikation nur in eine Richtung: Issa schreibt, Lukas
 * antwortet. Im autonomen Lauf ist das die falsche Richtung — dort arbeitet
 * Lukas allein, und wenn er etwas braucht (eine Entscheidung, einen Zugang,
 * eine Antwort auf eine Frage, die nur Issa beantworten kann), stand er still,
 * bis Issa zufaellig ins Dashboard sah.
 *
 * Zwei Wege, und zwar beide:
 *
 *  1. In den Chat. Genau dorthin, wo Issa ohnehin antwortet — die Meldung ist
 *     dann eine ganz normale Nachricht im Verlauf, auf die er einfach
 *     zurueckschreiben kann. Das ist der wichtigere der beiden Wege, denn er
 *     funktioniert immer und geht nicht verloren.
 *  2. Per WhatsApp, damit Issa es MERKT. Eine Nachricht im Dashboard, das
 *     niemand offen hat, erreicht ihn nicht.
 *
 * Der Chat-Weg ist Pflicht, der WhatsApp-Weg ist Zugabe: schlaegt WhatsApp
 * fehl oder ist es nicht eingerichtet, ist die Meldung trotzdem abgelegt.
 */

const TITEL = "Lukas meldet sich";

/*
 * Nicht zweimal dasselbe.
 *
 * Der autonome Lauf startet alle 30 Minuten neu. Ohne Sperre wuerde dieselbe
 * offene Frage bei jedem Durchlauf erneut auf Issas Handy landen — nach einem
 * Tag waeren das 48 identische Nachrichten, und danach liest er keine mehr.
 *
 * Im Speicher und mit Ablauf: nach einem Neustart darf er sich einmal
 * wiederholen. Das ist die harmlose Richtung.
 */
const zuletztGemeldet = new Map<string, number>();
const WIEDERHOLSPERRE_MS = Number(process.env.LUKAS_MELDE_SPERRE_MIN ?? 360) * 60 * 1000;

function ownerNummern(): string[] {
  const raw = (
    process.env.WHATSAPP_OWNER_NUMBERS ??
    process.env.WHATSAPP_ALLOWED_NUMBERS ??
    ""
  ).trim();
  return raw
    .split(",")
    .map((n) => n.replace(/[^0-9]/g, ""))
    .filter(Boolean);
}

async function meldeKonversation(): Promise<number> {
  const [vorhanden] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.title, TITEL))
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (vorhanden) return vorhanden.id;

  const [neu] = await db.insert(conversations).values({ title: TITEL }).returning();
  return neu.id;
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

  const jetzt = Date.now();
  const letzte = zuletztGemeldet.get(betreff);
  if (letzte !== undefined && jetzt - letzte < WIEDERHOLSPERRE_MS) {
    const min = Math.round((WIEDERHOLSPERRE_MS - (jetzt - letzte)) / 60000);
    return (
      `Das hast du Issa vor Kurzem schon gemeldet ("${betreff}"). Er hat es also — ` +
      `warte auf seine Antwort und arbeite in der Zwischenzeit an etwas anderem weiter. ` +
      `In ${min} Minuten könntest du erneut nachfassen, falls es dann noch offen ist.`
    );
  }
  zuletztGemeldet.set(betreff, jetzt);

  const nachricht =
    `${opts.dringend ? "⚠️ " : ""}**${betreff}**\n\n${text}\n\n` +
    `— Das kam aus meiner eigenen Arbeit, nicht aus einem Gespräch. Antworte mir ` +
    `einfach hier, dann mache ich weiter.`;

  const convId = await meldeKonversation();
  await db.insert(messages).values({
    conversationId: convId,
    role: "assistant",
    content: nachricht,
  });

  let perWhatsApp = false;
  const nummern = ownerNummern();
  if (whatsappConfigured() && nummern.length > 0) {
    for (const nummer of nummern) {
      try {
        await sendWhatsAppMessage(nummer, nachricht);
        perWhatsApp = true;
      } catch (err) {
        // Der Chat-Eintrag steht bereits — WhatsApp ist die Zugabe, nicht der
        // Kern. Ein Fehler hier darf die Meldung nicht verschlucken.
        logger.warn({ err, nummer }, "Meldung an Issa per WhatsApp fehlgeschlagen");
      }
    }
  }

  logger.info({ betreff, perWhatsApp }, "Lukas hat sich bei Issa gemeldet");

  return (
    `Issa hat deine Meldung "${betreff}" — sie steht im Chat unter "${TITEL}"` +
    `${perWhatsApp ? " und ist auf seinem Handy angekommen" : ""}. ` +
    (perWhatsApp
      ? ""
      : "WhatsApp ist nicht eingerichtet oder hat nicht funktioniert, er sieht sie also " +
        "erst beim nächsten Blick ins Dashboard. ") +
    `Bleib jetzt nicht stehen: arbeite an etwas anderem weiter, während du auf ihn wartest.`
  );
}
