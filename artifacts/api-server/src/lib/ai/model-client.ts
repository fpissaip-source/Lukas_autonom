import type OpenAI from "openai";
import { openai } from "@workspace/integrations-openai-ai";
import { logger } from "../logger";
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
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
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
    .map((part: any) => {
      if (part?.type === "text") return String(part.text ?? "");
      return "";
    })
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
        let input: unknown = {};
        try {
          input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          input = { raw_arguments: tc.function.arguments ?? "" };
        }
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
      out.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "" }] });
      continue;
    }

    out.push({ role: "user", content: toAnthropicUserContent(message.content) });
  }

  return { system: systemParts.join("\n\n"), messages: out };
}

async function callOpenAI(input: CallInput): Promise<LukasModelResult> {
  const response = await openai.chat.completions.create({
    model: input.route.model,
    max_completion_tokens: input.maxTokens ?? 8192,
    tools: input.tools,
    messages: input.messages,
  });
  const choice = response.choices[0];
  const toolCalls: LukasToolCall[] = [];
  for (const tc of choice?.message.tool_calls ?? []) {
    if (tc.type !== "function") continue;
    toolCalls.push({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
  }
  return {
    content: choice?.message.content ?? "",
    toolCalls,
    finishReason: choice?.finish_reason ?? null,
    route: input.route,
  };
}

async function callAnthropic(input: CallInput): Promise<LukasModelResult> {
  const converted = toAnthropicMessages(input.messages);
  const tools = input.tools.map((tool: any) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters ?? { type: "object", properties: {} },
  }));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.route.model,
      max_tokens: input.maxTokens ?? 8192,
      system: converted.system,
      messages: converted.messages,
      tools,
      tool_choice: { type: "auto" },
    }),
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
  // Gemini bietet einen OpenAI-kompatiblen Chat-Completions-Endpunkt. Dadurch
  // bleibt Lukas' kanonischer Nachrichten-/Tool-Kontext identisch und ein
  // Modellwechsel braucht keine eigene Persoenlichkeit oder eigenes Memory.
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${googleKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.route.model,
      max_completion_tokens: input.maxTokens ?? 8192,
      tools: input.tools,
      messages: input.messages,
      stream: false,
    }),
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
  try {
    if (input.route.provider === "anthropic") return await callAnthropic(input);
    if (input.route.provider === "google") return await callGoogle(input);
    return await callOpenAI(input);
  } catch (err) {
    logger.warn(
      { err, provider: input.route.provider, model: input.route.model, profile: input.route.profile },
      "Lukas provider call failed",
    );
    // Provider-Ausfall darf Lukas nicht in eine andere Person verwandeln oder
    // den Chat verlieren. Derselbe Kontext geht unveraendert an den Core-Fallback.
    if (input.route.provider !== "openai") {
      const fallback: ModelRoute = {
        provider: "openai",
        model: process.env.LUKAS_CORE_MODEL ?? "gpt-4o",
        profile: input.route.profile,
        reason: `Fallback nach ${input.route.provider}-Fehler`,
      };
      return await callOpenAI({ ...input, route: fallback });
    }
    throw err;
  }
}
