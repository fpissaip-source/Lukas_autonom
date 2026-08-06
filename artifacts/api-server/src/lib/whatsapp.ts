import crypto from "node:crypto";
import { logger } from "./logger";

/*
 * WhatsApp ueber die offizielle Meta Cloud API.
 *
 * Benoetigte Variablen (Issa legt sie in Railway an):
 *   WHATSAPP_TOKEN           dauerhafter Access-Token der Meta-App
 *   WHATSAPP_PHONE_NUMBER_ID ID der Absendernummer (aus dem Meta-Dashboard)
 *   WHATSAPP_VERIFY_TOKEN    frei gewaehlter String, muss beim Einrichten des
 *                            Webhooks in der Meta-Konsole identisch eingetragen
 *                            werden (Meta prueft damit, dass der Endpunkt uns
 *                            gehoert)
 *   WHATSAPP_ALLOWED_NUMBERS Kommaliste erlaubter Absender (siehe unten)
 */

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/*
 * WICHTIG: Der private Lukas hat Zugriff auf Issas Gedaechtnis, E-Mails,
 * GitHub und eine Shell mit root-Rechten. Die WhatsApp-Nummer ist oeffentlich
 * erreichbar — jeder, der sie kennt, koennte sonst mit diesem Lukas reden.
 * Deshalb antwortet er ausschliesslich auf ausdruecklich freigegebene Nummern.
 * Ohne gesetzte Liste antwortet er NIEMANDEM (fail closed statt fail open).
 */
export function isAllowedSender(from: string): boolean {
  const raw = process.env.WHATSAPP_ALLOWED_NUMBERS?.trim();
  if (!raw) return false;
  const normalize = (n: string) => n.replace(/[^0-9]/g, "");
  return raw
    .split(",")
    .map((n) => normalize(n))
    .filter(Boolean)
    .includes(normalize(from));
}

/*
 * Prueft Metas HMAC-Signatur ueber den rohen Request-Body. Ohne diese Pruefung
 * koennte jeder, der die Webhook-URL kennt, beliebige Nachrichten
 * einschleusen und damit Lukas' Tools ausloesen (inkl. Shell und E-Mail).
 * Ist WHATSAPP_APP_SECRET nicht gesetzt, wird bewusst ABGELEHNT statt
 * durchgewunken.
 */
export function verifyWhatsAppSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!secret) {
    logger.warn("WHATSAPP_APP_SECRET fehlt — Webhook-Anfrage wird abgelehnt");
    return false;
  }
  if (!rawBody || !signatureHeader?.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  // Laengengleichheit vorab pruefen: timingSafeEqual wirft bei ungleicher Laenge.
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}

export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error("WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID fehlen");

  // WhatsApp kappt Nachrichten ueber 4096 Zeichen — lieber selbst stueckeln,
  // damit nichts unbemerkt abgeschnitten wird.
  const chunks: string[] = [];
  let rest = text.trim() || "(keine Antwort)";
  while (rest.length > 0) {
    chunks.push(rest.slice(0, 3900));
    rest = rest.slice(3900);
  }

  for (const chunk of chunks) {
    const res = await fetch(`${GRAPH_BASE}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: chunk },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`WhatsApp senden fehlgeschlagen (${res.status}): ${body.slice(0, 300)}`);
    }
  }
}

/** Laedt eine per WhatsApp geschickte Datei (Bild/Sprachnachricht/Dokument). */
export async function downloadWhatsAppMedia(
  mediaId: string,
): Promise<{ data: Buffer; mimeType: string } | null> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) return null;
  try {
    const metaRes = await fetch(`${GRAPH_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;

    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(40000),
    });
    if (!fileRes.ok) return null;
    return {
      data: Buffer.from(await fileRes.arrayBuffer()),
      mimeType: meta.mime_type ?? "application/octet-stream",
    };
  } catch (err) {
    logger.warn({ err, mediaId }, "WhatsApp-Medien-Download fehlgeschlagen");
    return null;
  }
}
