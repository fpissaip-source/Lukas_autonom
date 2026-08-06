import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { attachments, conversations } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { recordDebugEvent } from "../lib/debug-log";

const router = Router();

// 20 MB pro Datei. Bewusst konservativ: die Datei landet Base64-kodiert in
// Postgres (~33% Aufschlag) und Bilder gehen zusaetzlich als Data-URL in den
// OpenAI-Request — groessere Uploads wuerden dort teuer bis abgelehnt.
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 5 },
});

// Endungs-Fallback: der MIME-Typ kommt vom Client und ist nicht verlaesslich —
// je nach Betriebssystem/Browser landen auch klare Faelle als
// "application/octet-stream" hier (im Test genau so bei einer .mp4 passiert).
// Ohne diesen Fallback wuerde ein Video als "unbekanntes Format" behandelt.
const EXT_KIND: Record<string, "image" | "pdf" | "text" | "video"> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  heic: "image", heif: "image", avif: "image", bmp: "image", svg: "image",
  pdf: "pdf",
  txt: "text", md: "text", csv: "text", json: "text", log: "text", yml: "text", yaml: "text",
  mp4: "video", mov: "video", webm: "video", avi: "video", mkv: "video", m4v: "video",
};

/** Bilder kann das Modell wirklich sehen, PDFs lesen, Text sowieso. */
export function attachmentKind(
  mimeType: string,
  filename?: string,
): "image" | "pdf" | "text" | "video" | "other" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/") || mimeType === "application/json") return "text";
  if (mimeType.startsWith("video/")) return "video";

  const ext = filename?.split(".").pop()?.toLowerCase();
  if (ext && EXT_KIND[ext]) return EXT_KIND[ext];
  return "other";
}

// ── UPLOAD ─────────────────────────────────────────────────────────────────
// Laeuft VOR dem Absenden der Nachricht: Issa waehlt Dateien, sie werden
// hochgeladen und bleiben ohne messageId liegen, bis die Nachricht existiert.
router.post(
  "/attachments/:conversationId",
  upload.array("files", 5),
  async (req, res) => {
    try {
      const conversationId = parseInt(String(req.params.conversationId));
      if (!Number.isFinite(conversationId)) {
        return void res.status(400).json({ error: "Ungültige conversationId" });
      }
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId));
      if (!conv) return void res.status(404).json({ error: "Conversation not found" });

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) return void res.status(400).json({ error: "Keine Datei erhalten" });

      const rows = await db
        .insert(attachments)
        .values(
          files.map((f) => ({
            conversationId,
            filename: f.originalname.slice(0, 300),
            mimeType: f.mimetype,
            sizeBytes: f.size,
            data: f.buffer.toString("base64"),
          })),
        )
        .returning();

      res.status(201).json(
        rows.map((r) => ({
          id: r.id,
          filename: r.filename,
          mimeType: r.mimeType,
          sizeBytes: r.sizeBytes,
          kind: attachmentKind(r.mimeType, r.filename),
          url: `/api/attachments/file/${r.id}`,
          createdAt: r.createdAt.toISOString(),
        })),
      );
    } catch (err) {
      logger.error({ err }, "Attachment upload error");
      recordDebugEvent("attachments/upload", err);
      const detail = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Upload fehlgeschlagen", detail });
    }
  },
);

// ── DATEI AUSLIEFERN ───────────────────────────────────────────────────────
router.get("/attachments/file/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    if (!row) return void res.status(404).json({ error: "Attachment not found" });

    res.setHeader("Content-Type", row.mimeType);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(row.filename)}"`,
    );
    res.send(Buffer.from(row.data, "base64"));
  } catch (err) {
    logger.error({ err }, "Attachment fetch error");
    res.status(500).json({ error: "Abruf fehlgeschlagen" });
  }
});

// ── ANHAENGE EINER KONVERSATION ────────────────────────────────────────────
router.get("/attachments/:conversationId", async (req, res) => {
  try {
    const conversationId = parseInt(String(req.params.conversationId));
    const rows = await db
      .select()
      .from(attachments)
      .where(eq(attachments.conversationId, conversationId));
    res.json(
      rows.map((r) => ({
        id: r.id,
        messageId: r.messageId,
        filename: r.filename,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        kind: attachmentKind(r.mimeType, r.filename),
        url: `/api/attachments/file/${r.id}`,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    logger.error({ err }, "Attachment list error");
    res.status(500).json({ error: "Abruf fehlgeschlagen" });
  }
});

// ── LOESCHEN (vor dem Absenden wieder abwaehlen) ───────────────────────────
router.delete("/attachments/file/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // Nur noch nicht abgeschickte Anhaenge duerfen weg — sonst wuerde eine
    // bereits gesendete Nachricht nachtraeglich ihren Kontext verlieren.
    const deleted = await db
      .delete(attachments)
      .where(and(eq(attachments.id, id), isNull(attachments.messageId)))
      .returning();
    if (deleted.length === 0) {
      return void res.status(404).json({ error: "Nicht gefunden oder bereits gesendet" });
    }
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Attachment delete error");
    res.status(500).json({ error: "Löschen fehlgeschlagen" });
  }
});

export default router;
