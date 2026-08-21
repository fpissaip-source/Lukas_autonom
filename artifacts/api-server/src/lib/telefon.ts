/*
 * Lukas am Telefon.
 *
 * Zwei Richtungen, aber nur EIN Weg durch den Code:
 *
 *   Eingehend  Anrufer -> Twilio-Nummer -> SIP-Trunk -> OpenAI -> Webhook hier
 *   Ausgehend  Lukas -> Twilio waehlt -> verbindet in denselben SIP-Trunk
 *              -> OpenAI -> derselbe Webhook hier
 *
 * Das ist der Grund, warum "Lukas ruft an" ueberhaupt geht: OpenAI selbst kann
 * keine Anrufe starten (die Realtime-API nimmt nur an). Twilio kann waehlen.
 * Also waehlt Twilio und uebergibt das abgenommene Gespraech an dieselbe
 * SIP-Adresse, an der auch eingehende Anrufe landen — danach ist es fuer uns
 * derselbe Fall.
 *
 * Die Nummer des Anrufers entscheidet, WELCHEN Lukas jemand bekommt. Ein
 * Telefonanschluss ist offen; ohne diese Pruefung bekaeme jeder Fehlanrufer
 * Issas privates Gedaechtnis ans Ohr.
 */
import { db } from "@workspace/db";
import { telefonNummern, telefonAnrufe } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { buildSystemPrompt } from "./system-prompt";
import { buildPublicSystemPrompt } from "./public-prompt";
import { SPRACH_REGEL, sprachAudio, sprachModell } from "./ai/sprach-sitzung";
import { logger } from "./logger";

export type Stufe = "privat" | "oeffentlich" | "gesperrt";

/**
 * Nur die Ziffern.
 *
 * Dieselbe Nummer kommt je nach Anbieter als "+4915112345678",
 * "004915112345678" oder "sip:4915112345678@irgendwas" an. Verglichen wird
 * deshalb ausschliesslich die Ziffernfolge — genau wie bei WhatsApp.
 */
export function normalisiere(roh: string): string {
  const nurZiffern = roh.replace(/[^0-9]/g, "");
  // Fuehrende Amtsnullen wegwerfen: 0049… und +49… sind dieselbe Nummer.
  return nurZiffern.replace(/^00/, "");
}

/** Die Nummer aus einem SIP-From-Header ziehen ("Name" <sip:49151…@host>). */
export function nummerAusSip(header: string): string {
  const treffer = header.match(/sip:([^@;>]+)/i);
  return normalisiere(treffer ? treffer[1] : header);
}

/*
 * Anrufe, die Lukas gerade selbst gestartet hat.
 *
 * Wenn Twilio unsere eigene Nummer in den SIP-Trunk verbindet, kommt der Anruf
 * beim Webhook an wie jeder andere — nur dass wir den Anlass kennen. Der wird
 * hier kurz geparkt und beim Verbinden wieder abgeholt.
 *
 * Bewusst im Speicher: zwischen Waehlen und Abnehmen liegen Sekunden. Ueberlebt
 * ein Neustart das nicht, ist der Anruf ohnehin weg.
 */
const offeneAusgehende = new Map<string, { anlass: string; seit: number }>();
const AUSGEHEND_GUELTIG_MS = 120_000;

function parkeAnlass(nummer: string, anlass: string): void {
  offeneAusgehende.set(normalisiere(nummer), { anlass, seit: Date.now() });
}

function holeAnlass(nummer: string): string | null {
  const key = normalisiere(nummer);
  const eintrag = offeneAusgehende.get(key);
  if (!eintrag) return null;
  offeneAusgehende.delete(key);
  return Date.now() - eintrag.seit > AUSGEHEND_GUELTIG_MS ? null : eintrag.anlass;
}

/** Welchen Lukas bekommt diese Nummer? Unbekannt = oeffentlich. */
export async function stufeFuer(nummer: string): Promise<{ stufe: Stufe; name: string }> {
  const key = normalisiere(nummer);
  if (!key) return { stufe: "oeffentlich", name: "" };

  const [treffer] = await db
    .select()
    .from(telefonNummern)
    .where(eq(telefonNummern.nummer, key))
    .limit(1);

  if (!treffer) return { stufe: "oeffentlich", name: "" };

  await db
    .update(telefonNummern)
    .set({ zuletztGesehen: new Date() })
    .where(eq(telefonNummern.id, treffer.id))
    .catch(() => {});

  const stufe = (["privat", "oeffentlich", "gesperrt"] as const).includes(treffer.stufe as Stufe)
    ? (treffer.stufe as Stufe)
    : "oeffentlich";
  return { stufe, name: treffer.name };
}

export async function protokolliere(eintrag: {
  richtung: "eingehend" | "ausgehend";
  nummer: string;
  ergebnis: string;
  stufe?: string;
  anlass?: string;
  detail?: string;
}): Promise<void> {
  await db
    .insert(telefonAnrufe)
    .values({
      richtung: eintrag.richtung,
      nummer: normalisiere(eintrag.nummer),
      ergebnis: eintrag.ergebnis,
      stufe: eintrag.stufe ?? "oeffentlich",
      anlass: eintrag.anlass ?? "",
      detail: (eintrag.detail ?? "").slice(0, 500),
    })
    .catch((err) => logger.warn({ err }, "Anruf konnte nicht protokolliert werden"));
}

/** Die Anweisungen fuer genau diesen Anrufer. */
async function anweisungen(stufe: Stufe, name: string, anlass: string | null): Promise<string> {
  const basis =
    stufe === "privat" ? await buildSystemPrompt() : await buildPublicSystemPrompt("web");

  const wer = name ? `Du sprichst mit ${name}.` : "";

  /*
   * Ein Telefonat ist kein Chat: es gibt keinen Bildschirm, niemand kann
   * zurueckscrollen, und eine Aufzaehlung vorgelesen zu bekommen ist eine
   * Zumutung. Das muss dranstehen, sonst antwortet er wie im Dashboard.
   */
  const amTelefon = `DU TELEFONIERST GERADE. ${wer}
- Sprich in kurzen, natuerlichen Saetzen. Keine Aufzaehlungen, keine Ueberschriften, kein Markdown.
- Der andere sieht nichts. Beschreibe kurz, was du tust, statt auf etwas zu verweisen.
- Wird es laenger als drei Saetze, mach eine Pause und frag nach, statt einen Vortrag zu halten.`;

  const grund = anlass
    ? `\n\nDU HAST ANGERUFEN. Der Anlass: ${anlass}\nKomm nach der Begrüßung direkt darauf zu sprechen.`
    : "";

  return `${SPRACH_REGEL}\n\n${amTelefon}${grund}\n\n${basis}`;
}

/**
 * Den Anruf annehmen.
 *
 * Der Anrufer haengt waehrenddessen in der Leitung und hoert Stille — deshalb
 * passiert hier nichts, was warten kann.
 */
export async function nimmAn(callId: string, vonNummer: string): Promise<Stufe> {
  const { stufe, name } = await stufeFuer(vonNummer);
  const anlass = holeAnlass(vonNummer);

  if (stufe === "gesperrt") {
    await weiseAb(callId, "Gesperrte Nummer");
    await protokolliere({ richtung: "eingehend", nummer: vonNummer, ergebnis: "abgewiesen", stufe });
    return stufe;
  }

  const res = await fetch(`https://api.openai.com/v1/realtime/calls/${callId}/accept`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "realtime",
      model: sprachModell(),
      instructions: await anweisungen(stufe, name, anlass),
      audio: sprachAudio(true),
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anruf annehmen fehlgeschlagen (${res.status}): ${text.slice(0, 300)}`);
  }

  await protokolliere({
    richtung: anlass ? "ausgehend" : "eingehend",
    nummer: vonNummer,
    ergebnis: "angenommen",
    stufe,
    anlass: anlass ?? "",
  });
  return stufe;
}

export async function weiseAb(callId: string, grund: string): Promise<void> {
  await fetch(`https://api.openai.com/v1/realtime/calls/${callId}/reject`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status_code: 603 }),
    signal: AbortSignal.timeout(10000),
  }).catch((err) => logger.warn({ err, grund }, "Abweisen fehlgeschlagen"));
}

/**
 * Lukas ruft an.
 *
 * Twilio waehlt und verbindet das abgenommene Gespraech per TwiML in den
 * SIP-Trunk — ab da laeuft es durch denselben Webhook wie ein eingehender
 * Anruf. Deshalb wird der Anlass vorher geparkt.
 */
/*
 * Zugangsdaten fuer Twilio.
 *
 * Es gibt zwei Wege, und in der Konsole liegen sie an verschiedenen Stellen:
 *
 *   Account SID + Auth Token   auf der Startseite unter "Account Info"
 *   API Key (SK…) + Secret     unter "API keys & tokens"
 *
 * Beide funktionieren als Basic-Auth. Der API Key ist der bessere Weg — er
 * laesst sich einzeln zurueckziehen, ohne dass alles andere stehenbleibt.
 *
 * Der Account SID wird IMMER gebraucht, auch mit API Key: er steht im Pfad
 * der URL, nicht in der Anmeldung. Genau daran scheitert es sonst.
 */
export function twilioZugang(): { sid: string; nutzer: string; geheim: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  if (!sid) return null;

  const key = process.env.TWILIO_API_KEY?.trim();
  const secret = process.env.TWILIO_API_SECRET?.trim();
  if (key && secret) return { sid, nutzer: key, geheim: secret };

  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (token) return { sid, nutzer: sid, geheim: token };

  return null;
}

export async function starteAnruf(nummer: string, anlass: string): Promise<string> {
  const zugang = twilioZugang();
  const von = process.env.TWILIO_NUMMER?.trim();
  const projekt = process.env.OPENAI_PROJECT_ID?.trim();

  if (!zugang || !von || !projekt) {
    return (
      "Zum Anrufen fehlen noch Zugangsdaten. Gebraucht werden TWILIO_ACCOUNT_SID (AC…), " +
      "TWILIO_NUMMER, OPENAI_PROJECT_ID — und zur Anmeldung entweder TWILIO_API_KEY " +
      "plus TWILIO_API_SECRET oder TWILIO_AUTH_TOKEN."
    );
  }
  const { sid } = zugang;

  const ziel = normalisiere(nummer);
  const [eintrag] = await db
    .select()
    .from(telefonNummern)
    .where(eq(telefonNummern.nummer, ziel))
    .limit(1);

  // Von sich aus anrufen darf er nur, wo Issa das ausdruecklich erlaubt hat.
  if (!eintrag?.darfAngerufenWerden) {
    await protokolliere({ richtung: "ausgehend", nummer: ziel, ergebnis: "abgewiesen", anlass });
    return `Diese Nummer ist nicht zum Anrufen freigegeben. Issa kann sie im Dashboard unter Telefon freischalten.`;
  }

  const sipZiel = `sip:${projekt}@${process.env.OPENAI_SIP_HOST ?? "sip.api.openai.com"};transport=tls`;
  const twiml = `<Response><Dial answerOnBridge="true"><Sip>${sipZiel}</Sip></Dial></Response>`;

  parkeAnlass(ziel, anlass);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${zugang.nutzer}:${zugang.geheim}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: `+${ziel}`, From: von, Twiml: twiml }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await protokolliere({
      richtung: "ausgehend",
      nummer: ziel,
      ergebnis: "fehlgeschlagen",
      anlass,
      detail: text,
    });
    return `Der Anruf ging nicht raus (${res.status}): ${text.slice(0, 200)}`;
  }

  await protokolliere({ richtung: "ausgehend", nummer: ziel, ergebnis: "gewaehlt", anlass });
  return `Ich rufe ${eintrag.name || "+" + ziel} gerade an.`;
}

/** Die letzten Anrufe fuer das Dashboard. */
export async function letzteAnrufe(grenze = 30) {
  return db.select().from(telefonAnrufe).orderBy(desc(telefonAnrufe.createdAt)).limit(grenze);
}
