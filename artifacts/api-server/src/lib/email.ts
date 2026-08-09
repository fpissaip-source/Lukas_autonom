import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

function requireEmailEnv(): { user: string; pass: string } {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      "EMAIL_USER/EMAIL_APP_PASSWORD sind nicht gesetzt — Issa muss ein Gmail-App-Passwort (myaccount.google.com/apppasswords, erfordert 2FA) in den Railway-Variablen hinterlegen.",
    );
  }
  return { user, pass };
}

/*
 * Ports und Verschlüsselung konfigurierbar, nicht fest auf Gmail verdrahtet.
 *
 * Hintergrund: Gmail nimmt SMTP auf 465 mit direktem TLS. iCloud (und viele
 * andere) nutzen 587 mit STARTTLS — dort ist `secure: false` richtig, obwohl
 * die Verbindung sehr wohl verschlüsselt wird: nodemailer handelt das per
 * STARTTLS aus. Mit fest verdrahtetem 465/secure schlug iCloud fehl.
 *
 * Faustregel, die hier automatisch angewandt wird: Port 465 -> secure=true,
 * alles andere -> STARTTLS. Per EMAIL_SMTP_SECURE übersteuerbar.
 */
function smtpSettings(): { host: string; port: number; secure: boolean } {
  const host = process.env.EMAIL_SMTP_HOST ?? "smtp.gmail.com";
  const port = Number(process.env.EMAIL_SMTP_PORT ?? (host.includes("me.com") ? 587 : 465));
  const override = process.env.EMAIL_SMTP_SECURE;
  const secure = override ? override === "true" : port === 465;
  return { host, port, secure };
}

async function withImap<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const { user, pass } = requireEmailEnv();
  const client = new ImapFlow({
    host: process.env.EMAIL_IMAP_HOST ?? "imap.gmail.com",
    port: Number(process.env.EMAIL_IMAP_PORT ?? 993),
    secure: true,
    auth: { user, pass },
    logger: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout();
  }
}

export async function searchEmails(query: string, limit = 10): Promise<string> {
  return withImap(async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search(
        query ? { or: [{ subject: query }, { body: query }, { from: query }] } : { all: true },
        { uid: true },
      );
      const sorted = (uids || []).slice().sort((a, b) => b - a).slice(0, limit);
      if (sorted.length === 0) return "Keine E-Mails gefunden.";
      const lines: string[] = [];
      for await (const msg of client.fetch(sorted, { envelope: true, uid: true }, { uid: true })) {
        const from = msg.envelope?.from?.[0];
        lines.push(
          `- [uid:${msg.uid}] Von: ${from ? `${from.name ?? ""} <${from.address}>` : "?"} | Betreff: ${msg.envelope?.subject ?? "(kein Betreff)"} | ${msg.envelope?.date?.toISOString() ?? ""}`,
        );
      }
      return lines.join("\n");
    } finally {
      lock.release();
    }
  });
}

export async function readEmail(uid: string): Promise<string> {
  return withImap(async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const msg = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!msg || !msg.source) throw new Error(`E-Mail mit uid ${uid} nicht gefunden.`);
      const parsed = await simpleParser(msg.source);
      const body = (parsed.text ?? parsed.html ?? "").toString();
      const truncated = body.length > 8000 ? body.slice(0, 8000) + "\n\n[... gekürzt]" : body;
      return `Von: ${parsed.from?.text ?? "?"}\nBetreff: ${parsed.subject ?? "(kein Betreff)"}\nDatum: ${parsed.date?.toISOString() ?? "?"}\n\n${truncated}`;
    } finally {
      lock.release();
    }
  });
}

// Issa will: Lukas darf E-Mails nur verschicken, wenn er im AKTUELLEN Chat-Turn
// ausdrücklich "senden"/"schicken" sagt. Das Prompt weist das Modell entsprechend
// an, aber zusätzlich prüfen wir hart serverseitig die rohe Nutzernachricht dieses
// Turns gegen — reines Modellverhalten allein wäre keine echte Absicherung gegen
// versehentliches/automatisches Versenden.
const SEND_TRIGGER_WORDS = [
  /\bsend(e|en|et)?\b/i,
  /\bschick(e|en|t)?\b/i,
  /\babschicken\b/i,
  /\bverschick(e|en|t)?\b/i,
];

export function userConfirmedSend(rawMessage: string): boolean {
  return SEND_TRIGGER_WORDS.some((re) => re.test(rawMessage));
}

export async function sendEmail(to: string, subject: string, body: string): Promise<string> {
  const { user, pass } = requireEmailEnv();
  const { host, port, secure } = smtpSettings();
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    // Bei STARTTLS-Ports (587) unverschlüsselt zu senden wäre inakzeptabel —
    // requireTLS erzwingt die Aushandlung, statt still im Klartext zu landen,
    // falls der Server sie nicht anbietet.
    requireTLS: !secure,
    auth: { user, pass },
  });
  await transport.sendMail({ from: user, to, subject, text: body });
  return `E-Mail an ${to} gesendet (Betreff: "${subject}").`;
}
