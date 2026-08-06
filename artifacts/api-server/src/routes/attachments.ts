import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { attachments, conversations } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { recordDebugEvent } from "../lib/debug-log";
import { createSignedAttachmentUrl } from "../lib/attachment-signing";

const router = Router();

export const MAX_VIDEO_UPLOAD_BYTES = 200 * 1024 * 1024;
export const MAX_OTHER_UPLOAD_BYTES = 30 * 1024 * 1024;
// Multer braucht vor dem Erkennen des Dateityps ein gemeinsames hartes Limit.
export const MAX_UPLOAD_BYTES = MAX_VIDEO_UPLOAD_BYTES;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 5 },
});

// Es darf nur ein grosser Upload gleichzeitig den RAM belegen. Kleine Dateien
// und normale Chat-Anfragen laufen weiter. Content-Length umfasst etwas
// Multipart-Overhead; fuer die Reservierung ist das bewusst egal.
let largeUploadInProgress = false;

// Endungs-Fallback: der MIME-Typ kommt vom Client und ist nicht verlaesslich.
const EXT_KIND: Record<string, "image" | "pdf" | "text" | "video"> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  heic: "image", heif: "image", avif: "image", bmp: "image", svg: "image",
  pdf: "pdf",
  txt: "text", md: "text", csv: "text", json: "text", log: "text", yml: "text", yaml: "text",
  mp4: "video", mov: "video", webm: "video", avi: "video", mkv: "video", m4v: "video",
};

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

function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

async function handleUpload(req: Request, res: Response): Promise<void> {
  try {
    const conversationId = parseInt(String(req.params.conversationId));
    if (!Number.isFinite(conversationId)) {
      res.status(400).json({ error: "Ungültige conversationId" });
      return;
    }

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: "Keine Datei erhalten" });
      return;
    }

    const classified = files.map((file) => ({
      file,
      kind: attachmentKind(file.mimetype, file.originalname),
    }));

    for (const { file, kind } of classified) {
      const limit = kind === "video" ? MAX_VIDEO_UPLOAD_BYTES : MAX_OTHER_UPLOAD_BYTES;
      if (file.size > limit) {
        res.status(413).json({
          error: "Datei ist zu groß",
          detail:
            kind === "video"
              ? `Videos dürfen maximal ${mb(MAX_VIDEO_UPLOAD_BYTES)} MB groß sein.`
              : `Andere Dateien dürfen maximal ${mb(MAX_OTHER_UPLOAD_BYTES)} MB groß sein.`,
        });
        return;
      }
    }

    const largeVideos = classified.filter(
      ({ file, kind }) => kind === "video" && file.size > MAX_OTHER_UPLOAD_BYTES,
    );
    if (largeVideos.length > 1) {
      res.status(400).json({
        error: "Zu viele große Videos",
        detail: "Bitte immer nur ein Video über 30 MB gleichzeitig hochladen.",
      });
      return;
    }

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
        messageId: r.messageId,
        filename: r.filename,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        kind: attachmentKind(r.mimeType, r.filename),
        url: createSignedAttachmentUrl(r.id),
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    logger.error({ err }, "Attachment upload error");
    recordDebugEvent("attachments/upload", err);
    const detail = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Upload fehlgeschlagen", detail });
  }
}

router.post(
  "/attachments/:conversationId",
  (req: Request, res: Response, next: NextFunction) => {
    const contentLength = Number(req.get("content-length") ?? 0);
    const needsLargeSlot = Number.isFinite(contentLength) && contentLength > MAX_OTHER_UPLOAD_BYTES;

    if (needsLargeSlot && largeUploadInProgress) {
      res.status(429).json({
        error: "Ein großer Upload läuft bereits",
        detail: "Warte kurz, bis der aktuelle große Video-Upload abgeschlossen ist.",
      });
      return;
    }

    if (needsLargeSlot) largeUploadInProgress = true;
    let released = false;
    const releaseLargeSlot = () => {
      if (!needsLargeSlot || released) return;
      released = true;
      largeUploadInProgress = false;
    };
    res.once("close", releaseLargeSlot);

    upload.array("files", 5)(req, res, (err: unknown) => {
      void (async () => {
        try {
          if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
              res.status(413).json({
                error: "Datei ist zu groß",
                detail: `Videos maximal ${mb(MAX_VIDEO_UPLOAD_BYTES)} MB, andere Dateien maximal ${mb(MAX_OTHER_UPLOAD_BYTES)} MB.`,
              });
              return;
            }
            res.status(400).json({ error: "Upload abgelehnt", detail: err.message });
            return;
          }
          if (err) {
            next(err);
            return;
          }
          await handleUpload(req, res);
        } finally {
          releaseLargeSlot();
        }
      })();
    });
  },
);

router.get("/attachments/file/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    if (!row) return void res.status(404).json({ error: "Attachment not found" });

    res.setHeader("Content-Type", row.mimeType);
    res.setHeader("Cache-Control", "private, max-age=3600");
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
        url: createSignedAttachmentUrl(r.id),
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    logger.error({ err }, "Attachment list error");
    res.status(500).json({ error: "Abruf fehlgeschlagen" });
  }
});

router.delete("/attachments/file/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
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
