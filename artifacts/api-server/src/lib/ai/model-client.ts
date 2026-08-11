import type OpenAI from "openai";
import { openai } from "@workspace/integrations-openai-ai";
import { logger } from "../logger";
import { fitLukasContext } from "./context-window";
import type { ModelRoute } from "./model-router";

export type LukasToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LukasModelResult = {
  content: string;
  toolCalls: LukasToolCall[];
  finishReason: string | null;
  route: ModelRoute;
};

type CallInput = {
  route: ModelRoute;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  maxTokens?: number;
};

function anthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY ist nicht gesetzt");
  return key;
}

function googleKey(): string {
  const key =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY ist nicht gesetzt");
  return key;
}

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: any) => (part?.type === "text" ? String(part.text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

function dataUrl(value: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function toAnthropicUserContent(content: unknown): any[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [{ type: "text", text: String(content ?? "") }];

  const blocks: any[] = [];
  for (const part of content as any[]) {
    if (part?.type === "text") {
      blocks.push({ type: "text", text: String(part.text ?? "") });
      continue;
    }
    if (part?.type === "image_url") {
      const parsed = dataUrl(String(part.image_url?.url ?? ""));
      if (parsed) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
        });
      }
      continue;
    }
    if (part?.type === "file") {
      const parsed = dataUrl(String(part.file?.file_data ?? ""));
      if (parsed?.mediaType === "application/pdf") {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: parsed.data },
          title: String(part.file?.filename ?? "document.pdf"),
        });
      } else {
        blocks.push({
          type: "text",
          text: `[Datei ${String(part.file?.filename ?? "unbekannt")} konnte fuer dieses Modell nicht direkt eingebettet werden.]`,
        });
      }
    }
  }
  return blocks.length > 0 ? blocks : [{ type: "text", text: "" }];
}

function toAnthropicMessages(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): { system: string; messages: any[] } {
  const systemParts: string[] = [];
  const out: any[] = [];

  for (const message of messages as any[]) {
    if (message.role === "system") {
      const text = asText(message.content);
      if (text) systemParts.push(text);
      continue;
    }

    if (message.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: String(message.tool_call_id ?? ""),
            content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
          },
        ],
      });
      continue;
    }

    if (message.role === "assistant") {
      const blocks: any[] = [];
      const text = asText(message.content);
      if (text) blocks.push({ type: "text", text });
      for (const tc of message.tool_calls ?? []) {
        if (tc.type !== "function") continue;
        let parsedInput: unknown = {};
        try {
          parsedInput = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedInput = { raw_arguments: tc.function.arguments ?? "" };
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: parsedInput });
      }
      out.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "" }] });
      continue;
    }

    out.push({ role: "user", content: toAnthropicUserContent(message.content) });
  }

  return { system: systemParts.join("\n\n"), messages: out };
}

/*
 * OpenAI Function Tools akzeptieren an der Wurzel nur ein Objekt-Schema.
 * Fremde MCP-Server (u.a. Higgsfield) liefern teilweise oneOf/anyOf/allOf etc.
 * direkt oben. Ein einziges solches Tool wuerde sonst den gesamten Request mit
 * HTTP 400 ablehnen. Deshalb wird DIREKT an der Provider-Grenze nochmals
 * normalisiert, unabhaengig davon, woher das Tool stammt.
 */
function sanitizeOpenAIToolSchema(schema: unknown): Record<string, unknown> {
  const empty: Record<string, unknown> = { type: "object", properties: {} };
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return empty;

  const source = schema as Record<string, unknown>;
  let base: Record<string, unknown> = { ...source };

  // Wenn das eigentliche Objekt in genau einer Variante steckt, behalten wir
  // dessen Felder statt sie beim Entfernen von oneOf/anyOf/allOf zu verlieren.
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const variants = source[key];
    if (Array.isArray(variants)) {
      const objectVariant = variants.find(
        (v) => v && typeof v === "object" && !Array.isArray(v) && (v as any).type === "object",
      );
      if (objectVariant) base = { ...base, ...(objectVariant as Record<string, unknown>) };
    }
  }

  for (const key of ["oneOf", "anyOf", "allOf", "not", "enum", "const"]) delete base[key];
  base.type = "object";
  if (!base.properties || typeof base.properties !== "object" || Array.isArray(base.properties)) {
    base.properties = {};
  }
  return base;
}

function toResponsesTools(tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined): any[] {
  return (tools ?? [])
    .filter((tool: any) => tool?.type === "function" && tool.function?.name)
    .map((tool: any) => ({
      type: "function",
      name: String(tool.function.name),
      description: String(tool.function.description ?? ""),
      parameters: sanitizeOpenAIToolSchema(tool.function.parameters),
      // Viele Lukas/MCP-Schemas haben optionale Felder und sind nicht im
      // strict-JSON-Schema-Subset formuliert. Validierung macht weiterhin das
      // Tool selbst; wichtig ist hier, dass OpenAI den Werkzeugkasten annimmt.
      strict: false,
    }));
}

function toResponsesContent(content: unknown): any {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");

  const out: any[] = [];
  for (const part of content as any[]) {
    if (part?.type === "text") {
      out.push({ type: "input_text", text: String(part.text ?? "") });
      continue;
    }
    if (part?.type === "image_url") {
      const url = String(part.image_url?.url ?? "");
      if (url) out.push({ type: "input_image", image_url: url, detail: part.image_url?.detail ?? "auto" });
      continue;
    }
    if (part?.type === "file") {
      const fileData = String(part.file?.file_data ?? "");
      if (fileData) {
        out.push({
          type: "input_file",
          file_data: fileData,
          filename: String(part.file?.filename ?? "document"),
        });
      }
    }
  }
  return out.length ? out : "";
}

function toResponsesInput(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): any[] {
  const out: any[] = [];

  for (const message of messages as any[]) {
    if (message.role === "tool") {
      out.push({
        type: "function_call_output",
        call_id: String(message.tool_call_id ?? ""),
        output: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      });
      continue;
    }

    if (message.role === "assistant") {
      const text = asText(message.content);
      if (text) out.push({ role: "assistant", content: text });
      for (const tc of message.tool_calls ?? []) {
        if (tc?.type !== "function") continue;
        out.push({
          type: "function_call",
          call_id: String(tc.id ?? ""),
          name: String(tc.function?.name ?? ""),
          arguments: String(tc.function?.arguments ?? "{}"),
        });
      }
      continue;
    }

    if (message.role === "system" || message.role === "developer" || message.role === "user") {
      out.push({ role: message.role, content: toResponsesContent(message.content) });
      continue;
    }

    // Unbekannte Chat-Rollen nicht still verlieren.
    out.push({ role: "user", content: toResponsesContent(message.content) });
  }

  return out;
}

async function callOpenAI(input: CallInput): Promise<LukasModelResult> {
  /*
   * Lukas ist ein Tool-Agent. Die 5.6-Reasoning-Modelle unterstuetzen Function
   * Tools nicht zusammen mit reasoning_effort auf /v1/chat/completions. Die
   * Responses API ist der vorgesehene Pfad fuer genau diese Kombination.
   */
  const request: any = {
    model: input.route.model,
    max_output_tokens: input.maxTokens ?? 8192,
    input: toResponsesInput(input.messages),
  };
  const tools = toResponsesTools(input.tools);
  if (tools.length) request.tools = tools;

  const response: any = await openai.responses.create(request);
  const toolCalls: LukasToolCall[] = [];
  for (const item of response.output ?? []) {
    if (item?.type !== "function_call") continue;
    toolCalls.push({
      id: String(item.call_id ?? item.id ?? `tool_${Date.now()}_${toolCalls.length}`),
      name: String(item.name ?? ""),
      arguments: String(item.arguments ?? "{}"),
    });
  }

  return {
    content: String(response.output_text ?? ""),
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : String(response.status ?? "stop"),
    route: input.route,
  };
}

async function callAnthropic(input: CallInput): Promise<LukasModelResult> {
  const converted = toAnthropicMessages(input.messages);
  const tools = (input.tools ?? []).map((tool: any) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters ?? { type: "object", properties: {} },
  }));

  const body: any = {
    model: input.route.model,
    max_tokens: input.maxTokens ?? 8192,
    system: converted.system,
    messages: converted.messages,
  };
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = { type: "auto" };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Anthropic ${response.status}: ${raw.slice(0, 1000)}`);
  const data = JSON.parse(raw) as any;
  const text: string[] = [];
  const toolCalls: LukasToolCall[] = [];
  for (const block of data.content ?? []) {
    if (block?.type === "text" && block.text) text.push(String(block.text));
    if (block?.type === "tool_use") {
      toolCalls.push({
        id: String(block.id ?? `tool_${Date.now()}_${toolCalls.length}`),
        name: String(block.name ?? ""),
        arguments: JSON.stringify(block.input ?? {}),
      });
    }
  }
  return {
    content: text.join(""),
    toolCalls,
    finishReason: data.stop_reason === "tool_use" ? "tool_calls" : String(data.stop_reason ?? "stop"),
    route: input.route,
  };
}

async function callGoogle(input: CallInput): Promise<LukasModelResult> {
  const body: any = {
    model: input.route.model,
    max_tokens: input.maxTokens ?? 8192,
    messages: input.messages,
    stream: false,
  };
  if (input.tools?.length) body.tools = input.tools;

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${googleKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${raw.slice(0, 1000)}`);
  const data = JSON.parse(raw) as any;
  const choice = data.choices?.[0];
  const toolCalls: LukasToolCall[] = [];
  for (const tc of choice?.message?.tool_calls ?? []) {
    if (tc?.type !== "function") continue;
    toolCalls.push({
      id: String(tc.id ?? `tool_${Date.now()}_${toolCalls.length}`),
      name: String(tc.function?.name ?? ""),
      arguments: String(tc.function?.arguments ?? "{}"),
    });
  }
  return {
    content: String(choice?.message?.content ?? ""),
    toolCalls,
    finishReason: String(choice?.finish_reason ?? "stop"),
    route: input.route,
  };
}

/** Ein gemeinsamer Modell-Aufruf. Provider sind Rechenkerne, nicht Identitaeten. */
export async function callLukasModel(input: CallInput): Promise<LukasModelResult> {
  // Die vollstaendige Historie bleibt persistent in DB/Memory. Nur die aktive
  // Payload wird bei sehr langen Threads auf das Provider-Fenster gepackt.
  const prepared: CallInput = { ...input, messages: fitLukasContext(input.messages) };

  try {
    if (prepared.route.provider === "anthropic") return await callAnthropic(prepared);
    if (prepared.route.provider === "google") return await callGoogle(prepared);
    return await callOpenAI(prepared);
  } catch (err) {
    logger.warn(
      {
        err,
        provider: prepared.route.provider,
        model: prepared.route.model,
        profile: prepared.route.profile,
      },
      "Lukas provider call failed",
    );
    if (prepared.route.provider !== "openai") {
      const fallback: ModelRoute = {
        provider: "openai",
        model: process.env.LUKAS_CORE_MODEL ?? "gpt-4o",
        profile: prepared.route.profile,
        reason: `Fallback nach ${prepared.route.provider}-Fehler`,
      };
      // Exakt dieselbe vorbereitete Lukas-Historie geht an den Fallback.
      return await callOpenAI({ ...prepared, route: fallback });
    }

    /*
     * OpenAI-Modell nicht nutzbar — z.B. weil der Account es nicht
     * freigeschaltet hat oder die ID nicht mehr existiert.
     *
     * Vorher flog der Fehler hier ungebremst durch und riss den kompletten Zug
     * mit: im Chat stand nur noch "Hmm, da ist etwas schiefgelaufen". Genau so
     * ist der oeffentliche Chat schon einmal ausgefallen, nachdem eine neue
     * Modell-ID eingetragen wurde, die der Account nicht hatte.
     *
     * Jetzt: einmal auf den Core zurueckfallen und die kaputte ID fuer eine
     * Weile merken, damit nicht jeder Aufruf erneut in denselben Fehler
     * laeuft. Eine falsche Modell-ID kostet damit Qualitaet, nicht die
     * Funktion.
     */
    const core = process.env.LUKAS_CORE_MODEL?.trim() || "gpt-4o";
    if (prepared.route.model !== core && isModelUnavailable(err)) {
      markModelBroken(prepared.route.model, err);
      return await callOpenAI({
        ...prepared,
        route: {
          provider: "openai",
          model: core,
          profile: prepared.route.profile,
          reason: `Fallback: ${prepared.route.model} nicht nutzbar`,
        },
      });
    }
    throw err;
  }
}

/*
 * Modelle, die dieser Account gerade nicht nutzen kann. Nur im Speicher und
 * mit Ablauf: nach einem Neustart oder einer Stunde wird es erneut versucht —
 * eine Freischaltung soll nicht bis zum naechsten Deploy unbemerkt bleiben.
 */
const brokenModels = new Map<string, number>();
const BROKEN_TTL_MS = 60 * 60 * 1000;

export function isModelBroken(model: string): boolean {
  const until = brokenModels.get(model);
  if (until === undefined) return false;
  if (Date.now() > until) {
    brokenModels.delete(model);
    return false;
  }
  return true;
}

function markModelBroken(model: string, err: unknown): void {
  brokenModels.set(model, Date.now() + BROKEN_TTL_MS);
  logger.error(
    { model, err },
    "Modell nicht nutzbar — Lukas arbeitet vorerst mit dem Core-Modell weiter",
  );
}

/** Fehlerbilder, bei denen ein anderes Modell nicht hilft, dieses aber tot ist. */
function isModelUnavailable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const message = String((err as { message?: string })?.message ?? "").toLowerCase();
  if (status === 404) return true;
  if (status === 403 && message.includes("model")) return true;
  return (
    message.includes("does not exist") ||
    message.includes("do not have access") ||
    message.includes("unknown model") ||
    message.includes("unsupported model") ||
    message.includes("invalid model")
  );
}
