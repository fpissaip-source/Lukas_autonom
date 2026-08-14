import { Router } from "express";
import type OpenAI from "openai";
import { db } from "@workspace/db";
import { conversations, messages, attachments as attachmentsTable } from "@workspace/db";
import { eq, desc, asc, and, isNull } from "drizzle-orm";
import { allLukasTools, executeLukasTool } from "../lib/lukas-tools";
import { recordEmotion } from "../lib/emotion-engine";
import { maybeReflect } from "../lib/reflection";
import { buildSystemPrompt } from "../lib/system-prompt";
import { logger } from "../lib/logger";
import { recordDebugEvent } from "../lib/debug-log";
import { attachmentKind } from "./attachments";
import { extractVideoFrames } from "../lib/video-frames";
import { rememberAssistantMessage, rememberUserMessage } from "../lib/conversation-memory";
import { routeLukasModel } from "../lib/ai/model-router";
import { callLukasModel } from "../lib/ai/model-client";
import { renderLukasVoice } from "../lib/ai/voice-renderer";
import type { ToolStep } from "@workspace/db";
import type { Response } from "express";

const router = Router();
const MAX_TOOL_ITERATIONS = 8;

/*
 * Ein Arbeitsschritt, wie ihn Issa sehen soll.
 *
 * Bisher lief im Chat nur "[⚙ execute_command]" durch — der Name des
 * Werkzeugs und sonst nichts. Welchen Befehl Lukas abgesetzt hat, was er einen
 * Subagenten gefragt hat und was zurueckkam, war nirgends sichtbar.
 *
 * Gekuerzt wird bewusst grosszuegig: ein Werkzeugergebnis kann eine ganze
 * Webseite sein, und die gehoert weder in die Leitung noch in die Datenbank.
 * 4000 Zeichen reichen, um zu verstehen, was passiert ist.
 */
const SCHRITT_MAX = 4000;

function kuerze(text: string): string {
  return text.length > SCHRITT_MAX
    ? `${text.slice(0, SCHRITT_MAX)}\n\n[… ${text.length - SCHRITT_MAX} weitere Zeichen]`
    : text;
}

function zeigeSchritt(
  tool: string,
  input: Record<string, unknown>,
  result: string,
  ok: boolean,
  ms: number,
  res: Response,
): ToolStep {
  const schritt: ToolStep = {
    tool,
    input: kuerze(JSON.stringify(input, null, 2)),
    result: kuerze(result),
    ok,
    ms,
  };
  // Sofort raus, damit man beim Zuschauen schon sieht, was er gerade getan hat.
  res.write(`data: ${JSON.stringify({ step: schritt })}\n\n`);
  return schritt;
}

router.get("/anthropic/conversations", async (_req, res) => {
  try {
    const rows = await db.select().from(conversations).orderBy(desc(conversations.createdAt));
    res.json(rows.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })));
  } catch {
    res.status(500).json({ error: "Failed to get conversations" });
  }
});

router.post("/anthropic/conversations", async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return void res.status(400).json({ error: "title required" });
    const [row] = await db.insert(conversations).values({ title }).returning();
    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch {
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.get("/anthropic/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) return void res.status(404).json({ error: "Conversation not found" });
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));
    res.json({
      ...conv,
      createdAt: conv.createdAt.toISOString(),
      messages: msgs.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    });
  } catch {
    res.status(500).json({ error: "Failed to get conversation" });
  }
});

router.delete("/anthropic/conversations/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) return void res.status(404).json({ error: "Conversation not found" });
    await db.delete(conversations).where(eq(conversations.id, id));
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

router.get("/anthropic/conversations/:id/messages", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));
    res.json(msgs.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })));
  } catch {
    res.status(500).json({ error: "Failed to get messages" });
  }
});

type AttachmentRow = typeof attachmentsTable.$inferSelect;

async function buildAttachmentParts(
  rows: AttachmentRow[],
  text: string,
): Promise<OpenAI.Chat.Completions.ChatCompletionContentPart[]> {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  if (text.trim()) parts.push({ type: "text", text });

  for (const row of rows) {
    const kind = attachmentKind(row.mimeType, row.filename);
    if (kind === "image") {
      parts.push({ type: "image_url", image_url: { url: `data:${row.mimeType};base64,${row.data}` } });
    } else if (kind === "pdf") {
      parts.push({
        type: "file",
        file: { filename: row.filename, file_data: `data:${row.mimeType};base64,${row.data}` },
      });
    } else if (kind === "text") {
      const decoded = Buffer.from(row.data, "base64").toString("utf-8");
      const clipped = decoded.length > 30000 ? decoded.slice(0, 30000) + "\n\n[... gekürzt]" : decoded;
      parts.push({ type: "text", text: `Datei "${row.filename}":\n\n${clipped}` });
    } else if (kind === "video") {
      const extracted = await extractVideoFrames(row.data, row.filename);
      if (extracted.ok) {
        const duration = extracted.durationSeconds
          ? `${extracted.durationSeconds.toFixed(1)} Sekunden`
          : "unbekannter Länge";
        parts.push({
          type: "text",
          text:
            `[Video "${row.filename}" (${duration}): daraus ${extracted.frames.length} gleichmäßig ` +
            `verteilte Standbilder in zeitlicher Reihenfolge. Du siehst KEIN durchgehendes Video ` +
            `und hörst KEINEN Ton — zwischen zwei Bildern kann etwas passieren, das du nicht ` +
            `siehst. Beschreibe nur, was tatsächlich zu sehen ist.]`,
        });
        for (const frame of extracted.frames) {
          parts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${frame}` } });
        }
      } else {
        // Der konkrete Grund gehoert hier hin, nicht nur ins Log: sonst steht
        // Lukas im Chat da und spekuliert ueber Dateipfade und Berechtigungen,
        // statt zu sagen, was wirklich kaputt ist.
        parts.push({
          type: "text",
          text:
            `[Video "${row.filename}" (${Math.round(row.sizeBytes / 1024)} KB) wurde angehängt, ` +
            `aber die Einzelbild-Extraktion ist fehlgeschlagen. Grund: ${extracted.reason} ` +
            `Du kannst das Video nicht auswerten — nenne Issa genau diesen Grund, erfinde ` +
            `keinen Inhalt und spekuliere nicht über Dateipfade oder Berechtigungen. ` +
            `Das ist ein Serverproblem, kein Problem mit seiner Datei.]`,
        });
      }
    } else {
      parts.push({
        type: "text",
        text:
          `[Datei "${row.filename}" (${row.mimeType}, ${Math.round(row.sizeBytes / 1024)} KB) ` +
          `wurde angehängt, dieses Format kannst du nicht lesen. Sag das ehrlich.]`,
      });
    }
  }
  return parts;
}

// Der alte /anthropic-Pfad bleibt aus Kompatibilitaetsgruenden bestehen. Intern
// ist er providerunabhaengig. Spezialmodell-Ausgaben werden NICHT direkt an die
// UI gestreamt; sichtbar ist nur die einheitliche Lukas-Ausgabeschicht.
router.post("/anthropic/conversations/:id/messages", async (req, res) => {
  /*
   * Lebenszeichen auf der Leitung.
   *
   * Das war der Grund, warum Lukas sporadisch gar nicht geantwortet hat. Auf
   * dieser Route wird die Antwort NICHT tokenweise gestreamt — sie geht am Ende
   * in einem Stueck raus. Zwischen dem letzten Werkzeug und der fertigen Antwort
   * fliesst also minutenlang kein einziges Byte. Jeder Proxy davor (Cloudflare
   * kappt bei rund 100 Sekunden Stille) haelt die Verbindung fuer tot und
   * schliesst sie. Im Chat kam dann nichts an, und weil erst am Ende in die
   * Datenbank geschrieben wird, war die Antwort auch nach dem Neuladen weg.
   *
   * Kurze Antworten kamen durch, lange nicht — genau das "sporadisch".
   *
   * Ein SSE-Kommentar alle 10 Sekunden haelt die Leitung offen. Der Browser
   * ignoriert Zeilen, die mit ":" beginnen.
   */
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  try {
    const convId = parseInt(req.params.id);
    const { content } = req.body;
    if (!content) return void res.status(400).json({ error: "content required" });

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
    if (!conv) return void res.status(404).json({ error: "Conversation not found" });

    const [userMessage] = await db
      .insert(messages)
      .values({ conversationId: convId, role: "user", content })
      .returning();
    rememberUserMessage(String(content), "dashboard");

    const pendingAttachments = await db
      .update(attachmentsTable)
      .set({ messageId: userMessage.id })
      .where(and(eq(attachmentsTable.conversationId, convId), isNull(attachmentsTable.messageId)))
      .returning();

    const systemPrompt = await buildSystemPrompt(String(content).slice(0, 1000));
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(asc(messages.createdAt));

    const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];

    if (pendingAttachments.length > 0) {
      const parts = await buildAttachmentParts(pendingAttachments, String(content));
      convo[convo.length - 1] = { role: "user", content: parts };
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // Nginx und Verwandte puffern text/event-stream sonst und geben erst am
    // Ende alles auf einmal frei — dann nuetzt auch der Heartbeat nichts.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, 10000);

    const internalDraftPieces: string[] = [];
    const usedTools: string[] = [];
    const schritte: ToolStep[] = [];
    const attachmentKinds = pendingAttachments.map((a) => attachmentKind(a.mimeType, a.filename));

    /*
     * Der Stopp-Knopf im Chat muss auch hier ankommen.
     *
     * Im Dashboard bricht er die Verbindung ab (AbortController). Das allein
     * stoppt aber nur die Anzeige: der Zug hier lief weiter, rief Werkzeuge auf,
     * kostete Geld und schrieb am Ende trotzdem eine Antwort in die Datenbank,
     * die beim naechsten Laden auftauchte. Ein Stopp, der nichts stoppt, ist
     * schlimmer als keiner.
     *
     * Deshalb: Verbindungsabbruch merken, vor jedem Modellaufruf und vor jedem
     * Werkzeug pruefen. Ein bereits laufendes Werkzeug laeuft zu Ende — danach
     * ist Schluss.
     */
    let abgebrochen = false;
    res.on("close", () => {
      if (!res.writableEnded) abgebrochen = true;
    });

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS && !abgebrochen; iteration++) {
      const route = routeLukasModel({
        userText: String(content),
        hasAttachments: pendingAttachments.length > 0,
        attachmentKinds,
        usedTools,
        iteration,
      });

      // Ohne festen Deckel: das Budget kommt aus dem Modell-Client, damit die
      // Denk-Tokens der Reasoning-Modelle die Antwort nicht auffressen.
      const result = await callLukasModel({
        route,
        tools: await allLukasTools(),
        messages: convo,
      });

      if (result.content) internalDraftPieces.push(result.content);
      if (result.toolCalls.length === 0) break;

      convo.push({
        role: "assistant",
        content: result.content || null,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const toolCall of result.toolCalls) {
        if (abgebrochen) break;
        usedTools.push(toolCall.name);
        res.write(`data: ${JSON.stringify({ tool: toolCall.name })}\n\n`);

        let input: Record<string, unknown> = {};
        try {
          input = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
        } catch {
          // Das Tool meldet fehlende/ungueltige Parameter selbst.
        }

        const begonnen = Date.now();
        try {
          const toolResult = await executeLukasTool(toolCall.name, input, {
            rawUserMessage: String(content),
            conversationId: convId,
          });
          convo.push({ role: "tool", tool_call_id: toolCall.id, content: toolResult });
          schritte.push(
            zeigeSchritt(toolCall.name, input, toolResult, true, Date.now() - begonnen, res),
          );
        } catch (err) {
          logger.warn({ err, tool: toolCall.name }, "Lukas tool failed");
          const grund = `Fehler: ${err instanceof Error ? err.message : String(err)}`;
          convo.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: grund,
          });
          schritte.push(
            zeigeSchritt(toolCall.name, input, grund, false, Date.now() - begonnen, res),
          );
          if (toolCall.name !== "feel") {
            recordEmotion({
              emotion: "frustration",
              valence: -0.3,
              intensity: 0.3,
              cause: `Tool ${toolCall.name} ist fehlgeschlagen`,
              source: "tool",
            }).catch(() => {});
          }
        }
      }

      if (
        internalDraftPieces.length > 0 &&
        !internalDraftPieces[internalDraftPieces.length - 1].endsWith("\n")
      ) {
        internalDraftPieces.push("\n\n");
      }
    }

    const draft = internalDraftPieces.join("").trim();

    /*
     * Abgebrochen: kein weiterer Modellaufruf mehr (renderLukasVoice waere
     * genau das). Was bis dahin entstanden ist, wird trotzdem gespeichert und
     * als gestoppt markiert — sonst faengt der naechste Turn ohne jede Spur an
     * und Lukas weiss nicht, dass Issa ihn unterbrochen hat.
     */
    if (abgebrochen) {
      if (draft) {
        await db.insert(messages).values({
          conversationId: convId,
          role: "assistant",
          content: `${draft}\n\n[Hier abgebrochen — die Verbindung zum Chat war weg.]`,
          steps: schritte.length ? schritte : null,
        });
      }
      logger.info({ conversationId: convId, usedTools }, "Chat abgebrochen");
      return;
    }

    const fullResponse = draft
      ? await renderLukasVoice({ systemPrompt, conversation: convo, draft })
      : "";

    /*
     * Eine leere Antwort ist kein Ergebnis.
     *
     * Vorher wurde in dem Fall nichts geschrieben und nichts gespeichert: im
     * Chat blieb es einfach still, und nach dem Neuladen stand dort die Frage
     * ohne Antwort — ohne jeden Hinweis, dass ueberhaupt etwas passiert ist.
     * Lieber ehrlich sagen, dass nichts herauskam.
     */
    const antwort =
      fullResponse ||
      "Ich habe für diese Nachricht keine Antwort zustande gebracht. Das ist ein Fehler auf " +
        "meiner Seite, nicht deiner — schick sie mir nochmal, und schau bei Diagnose nach, " +
        "was dort steht.";

    if (!fullResponse) {
      logger.warn({ conversationId: convId, usedTools }, "Chat ohne Antwort beendet");
      recordDebugEvent("chat", `Leere Antwort nach Werkzeugen: ${usedTools.join(", ") || "keine"}`);
    }

    res.write(`data: ${JSON.stringify({ content: antwort })}\n\n`);
    await db.insert(messages).values({
      conversationId: convId,
      role: "assistant",
      content: antwort,
      // Die Arbeitsschritte gehoeren an die Antwort, nicht in den fluechtigen
      // Stream — sonst sind sie nach dem Neuladen weg.
      steps: schritte.length ? schritte : null,
    });
    if (fullResponse) rememberAssistantMessage(fullResponse, "dashboard");

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    maybeReflect();
  } catch (err: unknown) {
    logger.error({ err }, "Chat error");
    recordDebugEvent("chat", err);
    /*
     * Der Grund gehoert in den Chat, nicht nur ins Log.
     *
     * "Stream failed" war fuer die Oberflaeche wertlos: sie kennt nur content,
     * tool und done und hat das Feld stillschweigend weggeworfen. Ein Fehler sah
     * damit genauso aus wie Schweigen.
     */
    const grund = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to send message", detail: grund });
    } else {
      res.write(`data: ${JSON.stringify({ error: grund })}\n\n`);
      res.end();
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
});

export default router;
