import { Router } from "express";
import { db } from "@workspace/db";
import { mediaJobsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { HIGGSFIELD_PROMPT_SYSTEM } from "../lib/lukas-soul.js";
import { recordEmotion } from "../lib/emotion-engine";

const router = Router();

const HIGGSFIELD_BASE = "https://platform.higgsfield.ai";

function getHiggsfieldAuth(): string | null {
  return process.env.HIGGSFIELD_API_KEY ?? null;
}

// ── GENERATE PROMPT ────────────────────────────────────────────────────────
router.post("/higgsfield/generate-prompt", async (req, res) => {
  try {
    const { vision, mediaType, style, imageUrl, model } = req.body;
    if (!vision || !mediaType)
      return void res.status(400).json({ error: "vision and mediaType required" });

    const userPrompt = `Erstelle einen perfekten Higgsfield-Prompt für folgende Vision:

VISION: "${vision}"
MEDIA-TYP: ${mediaType === "video" ? "Video (image-to-video)" : "Bild (text-to-image)"}
${style ? `STIL-HINT: ${style}` : ""}
${imageUrl ? `REFERENZ-BILD: ${imageUrl} (wird als Basis für Video verwendet)` : ""}
${model ? `GEWÜNSCHTES MODELL: ${model}` : ""}

Erstelle einen cinematischen, detaillierten Prompt auf Englisch der das Beste aus Higgsfield herausholt.
Antworte NUR mit dem JSON-Objekt.`;

    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8192,
      system: HIGGSFIELD_PROMPT_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    let parsed: Record<string, unknown>;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      return void res.status(500).json({ error: "Failed to parse AI response", raw: text });
    }

    res.json({
      prompt: parsed.prompt ?? "",
      negativePrompt: parsed.negativePrompt ?? null,
      suggestedModel: parsed.suggestedModel ?? (mediaType === "video"
        ? "bytedance/seedance/v1/pro/image-to-video"
        : "higgsfield-ai/soul/standard"),
      aspectRatio: parsed.aspectRatio ?? "16:9",
      duration: parsed.duration ?? (mediaType === "video" ? 5 : null),
      reasoning: parsed.reasoning ?? "",
    });
  } catch (err: unknown) {
    console.error("Prompt generation error:", err);
    res.status(500).json({ error: "Failed to generate prompt" });
  }
});

// ── GENERATE MEDIA ─────────────────────────────────────────────────────────
router.post("/higgsfield/generate", async (req, res) => {
  try {
    const { model, prompt, imageUrl, aspectRatio, duration, resolution, vision } = req.body;
    if (!model || !prompt)
      return void res.status(400).json({ error: "model and prompt required" });

    const mediaType = model.includes("video") ? "video" : "image";
    const apiKey = getHiggsfieldAuth();

    const [job] = await db
      .insert(mediaJobsTable)
      .values({
        model,
        prompt,
        vision: vision ?? null,
        status: "pending",
        mediaType,
        requestId: null,
        resultUrl: null,
      })
      .returning();

    if (apiKey) {
      try {
        const body: Record<string, unknown> = { prompt };
        if (imageUrl) body.image_url = imageUrl;
        if (aspectRatio) body.aspect_ratio = aspectRatio;
        if (duration && mediaType === "video") body.duration = duration;
        if (resolution) body.resolution = resolution;

        const response = await fetch(`${HIGGSFIELD_BASE}/${model}`, {
          method: "POST",
          headers: {
            Authorization: `Key ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          const data = (await response.json()) as Record<string, unknown>;
          const requestId = (data.id ?? data.request_id ?? data.requestId) as string | undefined;
          if (requestId) {
            await db
              .update(mediaJobsTable)
              .set({ requestId, status: "processing", updatedAt: new Date() })
              .where(eq(mediaJobsTable.id, job.id));
            job.requestId = requestId;
            job.status = "processing";
          }
        } else {
          const errText = await response.text().catch(() => "");
          console.error(`Higgsfield API error ${response.status}: ${errText.slice(0, 500)}`);
          await db
            .update(mediaJobsTable)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(mediaJobsTable.id, job.id));
          job.status = "failed";
        }
      } catch (apiErr) {
        console.error("Higgsfield API error:", apiErr);
        await db
          .update(mediaJobsTable)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(mediaJobsTable.id, job.id));
        job.status = "failed";
      }
    } else {
      // Kein API-Key konfiguriert — ehrlich als failed markieren statt den Job
      // für immer auf "processing" hängen zu lassen.
      await db
        .update(mediaJobsTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(mediaJobsTable.id, job.id));
      job.status = "failed";
    }

    res.status(202).json({
      ...job,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("Generate media error:", err);
    res.status(500).json({ error: "Failed to submit generation request" });
  }
});

// ── STATUS ─────────────────────────────────────────────────────────────────
router.get("/higgsfield/status/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;
    const apiKey = getHiggsfieldAuth();

    const [job] = await db
      .select()
      .from(mediaJobsTable)
      .where(eq(mediaJobsTable.requestId, requestId));

    if (!job) return void res.status(404).json({ error: "Job not found" });

    if (apiKey && job.status === "processing" && job.requestId) {
      try {
        const response = await fetch(
          `${HIGGSFIELD_BASE}/requests/${job.requestId}/status`,
          { headers: { Authorization: `Key ${apiKey}` } }
        );

        if (response.ok) {
          const data = (await response.json()) as Record<string, unknown>;
          const newStatus = data.status as string | undefined;
          const outputUrl = (data.output ?? data.result ?? data.url) as string | undefined;

          let mapped = job.status;
          if (newStatus === "succeeded" || newStatus === "completed") mapped = "completed";
          else if (newStatus === "failed") mapped = "failed";
          else if (newStatus === "processing" || newStatus === "in-progress") mapped = "processing";

          if (mapped !== job.status || outputUrl) {
            // Fertige Kreationen freuen Lukas, gescheiterte wurmen ihn
            // (job.status ist hier immer "processing" — jeder Wechsel ist neu).
            if (mapped === "completed") {
              recordEmotion({
                emotion: "joy",
                valence: 0.4,
                intensity: 0.4,
                cause: `${job.mediaType === "video" ? "Video" : "Bild"} fertig generiert: ${(job.vision ?? job.prompt).slice(0, 80)}`,
                source: "media",
              }).catch(() => {});
            } else if (mapped === "failed") {
              recordEmotion({
                emotion: "frustration",
                valence: -0.4,
                intensity: 0.4,
                cause: `Media-Generierung fehlgeschlagen: ${(job.vision ?? job.prompt).slice(0, 80)}`,
                source: "media",
              }).catch(() => {});
            }
            const [updated] = await db
              .update(mediaJobsTable)
              .set({
                status: mapped,
                resultUrl: outputUrl ?? job.resultUrl,
                updatedAt: new Date(),
              })
              .where(eq(mediaJobsTable.id, job.id))
              .returning();
            return void res.json({
              ...updated,
              createdAt: updated.createdAt.toISOString(),
              updatedAt: updated.updatedAt.toISOString(),
            });
          }
        }
      } catch {}
    }

    res.json({
      ...job,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get status" });
  }
});

// ── ALL JOBS ───────────────────────────────────────────────────────────────
router.get("/higgsfield/jobs", async (req, res) => {
  try {
    const jobs = await db
      .select()
      .from(mediaJobsTable)
      .orderBy(desc(mediaJobsTable.createdAt))
      .limit(50);

    res.json(
      jobs.map((j) => ({
        ...j,
        createdAt: j.createdAt.toISOString(),
        updatedAt: j.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to get jobs" });
  }
});

export default router;
