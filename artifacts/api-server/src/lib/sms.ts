import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { smsNachrichten, telefonNummern } from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { logger } from "./logger";

/*
 * SMS über ClickSend.
 *
 * Warum nicht über Twilio, wo doch das Telefon dort haengt: Issa hat sich fuer
 * ClickSend entschieden. Fuer den Code ist es ohnehin nur ein anderer
 * Endpunkt — die Regeln drumherum sind dieselben und stehen hier, nicht beim
 * Anbieter.
 *
 * Drei Regeln, und alle drei aus einem Grund: eine SMS ist weg, sobald sie weg
 * ist. Es gibt kein Zurueckholen und keinen Papierkorb.
 *
 *  1. Nur echte Nummern in internationaler Schreibweise. "0171 1234" ist keine
 *     Adresse, sondern eine Vermutung.
 *  2. Wer in der Telefonliste als GESPERRT steht, bekommt auch keine SMS. Es
 *     waere absurd, eine Nummer am Telefon abzuweisen und ihr dann zu
 *     schreiben.
 *  3. Jede Nachricht wird protokolliert — mit dem Unterschied, ob Issa sie
 *     getippt oder Lukas sie formuliert hat.
 */

const BASIS = "https://rest.clicksend.com/v3";

/*
 * Wie lange dieselbe Nachricht als Wiederholungsversuch gilt.
 *
 * Fuenf Minuten: lang genug fuer jeden Retry, den ein Zug erzeugt (Timeout,
 * Netzabbruch, ein zweiter Anlauf des Modells), kurz genug, dass "Bin gleich
 * da" spaeter am Tag wieder durchgeht.
 */
const IDEMPOTENZ_FENSTER_MS = 5 * 60 * 1000;

export type SmsErgebnis = {
  ok: boolean;
  status: string;
  nummer: string;
  segmente: number;
  preis?: string;
  fehler?: string;
  /** Wurde nicht erneut gesendet, weil dieselbe Nachricht gerade schon rausging. */
  wiederholung?: boolean;
};

export function zugangVorhanden(): boolean {
  return Boolean(process.env.CLICKSEND_USERNAME?.trim() && process.env.CLICKSEND_API_KEY?.trim());
}

/** Der Absender, den der Empfänger sieht. Leer = die Nummer des Kontos. */
function absender(): string | undefined {
  return process.env.CLICKSEND_ABSENDER?.trim() || undefined;
}

/**
 * Nummer in internationale Schreibweise bringen — oder ehrlich ablehnen.
 *
 * Deutsche Nummern schreibt man im Alltag mit fuehrender Null. Die kann man
 * umrechnen, WENN man weiss, dass es eine deutsche ist; deshalb geht das nur
 * mit ausdruecklicher Vorwahl aus der Umgebung. Raten waere hier der falsche
 * Dienst am Kunden: die SMS ginge an irgendwen.
 */
export function normalisiereNummer(roh: string): string | null {
  const knapp = String(roh ?? "").replace(/[\s/\-().]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(knapp)) return knapp;

  const land = process.env.LUKAS_LAENDERVORWAHL?.trim();
  if (land && /^0[1-9]\d{6,13}$/.test(knapp)) {
    return `${land}${knapp.slice(1)}`;
  }
  return null;
}

/*
 * Das Alphabet, das eine SMS "billig" macht.
 *
 * Passt der Text hier hinein, gehen 160 Zeichen in eine Nachricht. Ein
 * einziges Zeichen ausserhalb — ein Emoji, ein typografischer Gedankenstrich,
 * ein Anfuehrungszeichen aus Word — schaltet die ganze Nachricht auf Unicode,
 * und dann sind es 70. Deshalb steht die Zahl in der Oberflaeche: sonst wundert
 * man sich hinterher ueber die Rechnung.
 */
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà" +
  "^{}\\[~]|€";

export function segmente(text: string): number {
  const unicode = [...text].some((z) => !GSM7.includes(z));
  const einzeln = unicode ? 70 : 160;
  const inKette = unicode ? 67 : 153;
  if (text.length <= einzeln) return 1;
  return Math.ceil(text.length / inKette);
}

export async function sendeSms(opts: {
  an: string;
  text: string;
  quelle?: "dashboard" | "lukas";
}): Promise<SmsErgebnis> {
  const text = String(opts.text ?? "").trim();
  const quelle = opts.quelle ?? "dashboard";

  if (!text) throw new Error("Ohne Text keine SMS.");
  if (text.length > 1200) {
    throw new Error(
      `Die Nachricht ist ${text.length} Zeichen lang. Ab etwa 1200 wird daraus eine teure ` +
        `Kette aus einem Dutzend Einzel-SMS — schreib es kürzer oder schick eine Mail.`,
    );
  }

  const nummer = normalisiereNummer(opts.an);
  if (!nummer) {
    throw new Error(
      `"${opts.an}" ist keine Nummer in internationaler Schreibweise (+49…). Ohne Ländervorwahl ` +
        `wird nicht geraten — die SMS ginge sonst an irgendwen.`,
    );
  }

  /*
   * Dieselbe Nachricht nicht zweimal.
   *
   * Der Ablauf, gegen den das steht: die SMS geht raus, danach bricht die
   * Verbindung weg, der Aufruf sieht aus wie gescheitert, der Agent versucht
   * es erneut. Der Empfaenger bekommt sie doppelt, bezahlt ist sie zweimal —
   * und zurueckholen laesst sich nichts davon.
   *
   * Der Fingerabdruck ist bewusst inhaltlich (Nummer + Text + Quelle) und
   * nicht ein vom Aufrufer mitgegebener Schluessel: der Wiederholungsversuch
   * kommt aus dem Modell, und das kann keinen stabilen Schluessel fuehren.
   *
   * Das Fenster ist die eigentliche Entscheidung. Zu kurz und der Schutz
   * greift nicht; zu lang und "Bin da" laesst sich am selben Tag nicht
   * zweimal schicken. Fuenf Minuten decken jeden Wiederholungsversuch ab,
   * den ein Zug erzeugt.
   */
  const fingerabdruck = createHash("sha256")
    .update(`${nummer}\u0000${text}\u0000${quelle}`)
    .digest("hex")
    .slice(0, 32);
  const fensterBeginn = new Date(Date.now() - IDEMPOTENZ_FENSTER_MS);
  const [schonRaus] = await db
    .select()
    .from(smsNachrichten)
    .where(
      and(
        eq(smsNachrichten.fingerabdruck, fingerabdruck),
        gte(smsNachrichten.createdAt, fensterBeginn),
      ),
    )
    .limit(1);

  if (schonRaus) {
    logger.info(
      { nummer, fingerabdruck, id: schonRaus.id },
      "Dieselbe SMS ging vor Kurzem schon raus — nicht erneut gesendet",
    );
    return {
      ok: true,
      nummer,
      status: schonRaus.status,
      segmente: 0,
      preis: schonRaus.preis ?? undefined,
      wiederholung: true,
    };
  }

  // Wer am Telefon abgewiesen wird, bekommt auch keine SMS.
  const [eintrag] = await db
    .select()
    .from(telefonNummern)
    .where(eq(telefonNummern.nummer, nummer))
    .limit(1);
  if (eintrag?.stufe === "gesperrt") {
    throw new Error(`${nummer} steht in der Telefonliste auf "gesperrt" — an die geht nichts raus.`);
  }

  if (!zugangVorhanden()) {
    throw new Error(
      "Für SMS fehlen die Zugangsdaten: CLICKSEND_USERNAME und CLICKSEND_API_KEY setzen " +
        "(optional CLICKSEND_ABSENDER als sichtbarer Absender).",
    );
  }

  const auth = Buffer.from(
    `${process.env.CLICKSEND_USERNAME!.trim()}:${process.env.CLICKSEND_API_KEY!.trim()}`,
  ).toString("base64");

  const [zeile] = await db
    .insert(smsNachrichten)
    /*
     * Die Zeile entsteht VOR dem Versand, mit Status "offen" — das war schon
     * so und ist genau richtig: damit wirkt der Fingerabdruck oben wie eine
     * Reservierung. Ein zweiter Anlauf findet die Zeile auch dann, wenn der
     * erste Versand noch unterwegs ist.
     */
    .values({ richtung: "raus", nummer, text, quelle, status: "offen", fingerabdruck })
    .returning();

  try {
    const antwort = await fetch(`${BASIS}/sms/send`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            to: nummer,
            body: text,
            ...(absender() ? { from: absender() } : {}),
            source: "lukas",
            custom_string: `${quelle}-${zeile.id}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });

    const roh = await antwort.text();
    let daten: any = null;
    try {
      daten = JSON.parse(roh);
    } catch {
      /* Der Text unten reicht als Fehlerbild. */
    }

    const meldung = daten?.data?.messages?.[0];
    const status = String(meldung?.status ?? daten?.response_code ?? `HTTP ${antwort.status}`);
    const ok = antwort.ok && /success/i.test(status);

    await db
      .update(smsNachrichten)
      .set({
        status,
        anbieterId: meldung?.message_id ? String(meldung.message_id) : null,
        preis: meldung?.message_price != null ? String(meldung.message_price) : null,
        // Bewusst nur der Anfang: eine Fehlerantwort kann lang sein, und in der
        // Zeile soll etwas Lesbares stehen.
        fehler: ok ? null : roh.slice(0, 500),
      })
      .where(eq(smsNachrichten.id, zeile.id));

    // Absichtlich ohne Text und ohne Zugangsdaten im Protokoll.
    logger.info({ nummer, status, quelle, segmente: segmente(text) }, "SMS verschickt");

    return {
      ok,
      status,
      nummer,
      segmente: segmente(text),
      preis: meldung?.message_price != null ? String(meldung.message_price) : undefined,
      fehler: ok ? undefined : (meldung?.status ?? roh.slice(0, 200)),
    };
  } catch (err) {
    const grund = err instanceof Error ? err.message : String(err);
    await db
      .update(smsNachrichten)
      .set({ status: "fehlgeschlagen", fehler: grund.slice(0, 500) })
      .where(eq(smsNachrichten.id, zeile.id));
    logger.warn({ nummer, err }, "SMS fehlgeschlagen");
    throw new Error(`SMS an ${nummer} ging nicht raus: ${grund}`);
  }
}

export async function letzteSms(grenze = 50) {
  return db.select().from(smsNachrichten).orderBy(desc(smsNachrichten.createdAt)).limit(grenze);
}
