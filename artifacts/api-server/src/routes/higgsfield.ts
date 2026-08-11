import { Router } from "express";
import { db } from "@workspace/db";
import { mediaJobsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai";
import { HIGGSFIELD_PROMPT_SYSTEM } from "../lib/lukas-soul.js";
import { recordEmotion } from "../lib/emotion-engine";
import { logger } from "../lib/logger";
import { recordDebugEvent } from "../lib/debug-log";
import { findServerWithTool, callMcpTool } from "../lib/mcp";
import { directModel } from "../lib/ai/model-router";

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

    const response = await openai.chat.completions.create({
      model: directModel("general"),
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: HIGGSFIELD_PROMPT_SYSTEM },
        { role: "user", content: userPrompt },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "";

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

    /*
     * Zuerst MCP.
     *
     * Das Studio rief Higgsfield direkt per REST-API und eigenem Schluessel
     * auf, obwohl daneben eine fertige MCP-Verbindung mit OAuth stand. Zwei
     * Wege zum selben Anbieter, von denen nur einer gepflegt wird, laufen
     * frueher oder spaeter auseinander — und der Schluessel-Weg braucht einen
     * zusaetzlichen Zugang, den man separat erneuern muss.
     *
     * Ist kein MCP-Server verbunden, bleibt der alte Weg als Rueckfall. Wer
     * bisher nur den Schluessel gesetzt hat, merkt von der Umstellung nichts.
     */
    const viaMcp = await findServerWithTool(
      mediaType === "video" ? "generate_video" : "generate_image",
    ).catch(() => null);

    if (viaMcp) {
      try {
        const args: Record<string, unknown> = { prompt };
        if (imageUrl) args.image_url = imageUrl;
        if (aspectRatio) args.aspect_ratio = aspectRatio;
        if (duration && mediaType === "video") args.duration = duration;
        if (resolution) args.resolution = resolution;
        // model kommt aus der Studio-Auswahl; der MCP-Server nimmt es als Hinweis.
        if (model) args.model = model;

        const text = await callMcpTool(viaMcp.server.id, viaMcp.tool, args);

        // MCP-Antworten sind Text. Die erste enthaltene Medien-URL ist das
        // Ergebnis; findet sich keine, laeuft der Auftrag beim Anbieter noch
        // und der Rohtext bleibt als Beleg stehen.
        const url = text.match(/https?:\/\/[^\s"'<>)]+\.(?:png|jpe?g|webp|gif|mp4|webm|mov)/i)?.[0];
        await db
          .update(mediaJobsTable)
          .set({
            requestId: `mcp:${viaMcp.server.slug}`,
            status: url ? "completed" : "processing",
            resultUrl: url ?? null,
            error: url ? null : text.slice(0, 1000),
            updatedAt: new Date(),
          })
          .where(eq(mediaJobsTable.id, job.id));
        job.requestId = `mcp:${viaMcp.server.slug}`;
        job.status = url ? "completed" : "processing";
        job.resultUrl = url ?? null;

        return void res.status(202).json({
          ...job,
          createdAt: job.createdAt.toISOString(),
          updatedAt: job.updatedAt.toISOString(),
        });
      } catch (mcpErr) {
        const reason = `MCP-Server "${viaMcp.server.name}": ${
          mcpErr instanceof Error ? mcpErr.message : String(mcpErr)
        }`;
        logger.error({ err: mcpErr, model }, reason);
        recordDebugEvent("higgsfield/generate", reason);
        await db
          .update(mediaJobsTable)
          .set({ status: "failed", error: reason, updatedAt: new Date() })
          .where(eq(mediaJobsTable.id, job.id));
        job.status = "failed";
        job.error = reason;
        return void res.status(202).json({
          ...job,
          createdAt: job.createdAt.toISOString(),
          updatedAt: job.updatedAt.toISOString(),
        });
      }
    }

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
          const reason = `Higgsfield API ${response.status}: ${errText.slice(0, 400) || "(keine Antwort)"}`;
          logger.error({ status: response.status, model }, reason);
          recordDebugEvent("higgsfield/generate", reason);
          await db
            .update(mediaJobsTable)
            .set({ status: "failed", error: reason, updatedAt: new Date() })
            .where(eq(mediaJobsTable.id, job.id));
          job.status = "failed";
          job.error = reason;
        }
      } catch (apiErr) {
        const reason = `Higgsfield nicht erreichbar: ${apiErr instanceof Error ? apiErr.message : String(apiErr)}`;
        logger.error({ err: apiErr, model }, reason);
        recordDebugEvent("higgsfield/generate", reason);
        await db
          .update(mediaJobsTable)
          .set({ status: "failed", error: reason, updatedAt: new Date() })
          .where(eq(mediaJobsTable.id, job.id));
        job.status = "failed";
        job.error = reason;
      }
    } else {
      // Weder MCP-Verbindung noch Schluessel — ehrlich als failed markieren
      // statt den Job für immer auf "processing" hängen zu lassen.
      const reason =
        "Kein Weg zu Higgsfield: unter „MCP“ ist kein Server mit generate_image/generate_video verbunden, und HIGGSFIELD_API_KEY ist auch nicht gesetzt.";
      recordDebugEvent("higgsfield/generate", reason);
      await db
        .update(mediaJobsTable)
        .set({ status: "failed", error: reason, updatedAt: new Date() })
        .where(eq(mediaJobsTable.id, job.id));
      job.status = "failed";
      job.error = reason;
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

    /*
     * Auftraege ueber MCP tragen als requestId "mcp:<server>". Die gehoert
     * nicht der Higgsfield-REST-API — sie hier weiterzureichen wuerde einen
     * Abruf auf /requests/mcp:.../status ausloesen und jedes Mal in einen
     * 404 laufen. Der MCP-Server liefert sein Ergebnis bereits im Tool-Aufruf.
     */
    const ueberMcp = job.requestId?.startsWith("mcp:") ?? false;

    if (!ueberMcp && apiKey && job.status === "processing" && job.requestId) {
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
