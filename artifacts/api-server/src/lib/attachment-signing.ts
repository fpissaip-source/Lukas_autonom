import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

function signingSecret(): string {
  return (
    process.env.LUKAS_ATTACHMENT_SIGNING_SECRET?.trim() ||
    process.env.LUKAS_API_TOKEN?.trim() ||
    ""
  );
}

function signatureFor(id: number, expires: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${id}:${expires}`)
    .digest("base64url");
}

function safeEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export function createSignedAttachmentUrl(
  id: number,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const secret = signingSecret();
  const base = `/api/attachments/file/${id}`;

  // In lokaler Entwicklung ohne Token bleibt der alte Pfad nutzbar. In
  // Produktion erzwingt die API ohnehin LUKAS_API_TOKEN.
  if (!secret) return base;

  const expires = Math.floor(Date.now() / 1000) + Math.max(60, ttlSeconds);
  const signature = signatureFor(id, expires, secret);
  return `${base}?expires=${expires}&signature=${encodeURIComponent(signature)}`;
}

export function isValidAttachmentSignature(
  idValue: string,
  expiresValue: unknown,
  signatureValue: unknown,
): boolean {
  const secret = signingSecret();
  if (!secret) return false;

  const id = Number.parseInt(idValue, 10);
  const expires =
    typeof expiresValue === "string" ? Number.parseInt(expiresValue, 10) : Number.NaN;
  const signature = typeof signatureValue === "string" ? signatureValue : "";

  if (!Number.isSafeInteger(id) || id <= 0) return false;
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) {
    return false;
  }
  if (!signature) return false;

  return safeEqual(signature, signatureFor(id, expires, secret));
}
