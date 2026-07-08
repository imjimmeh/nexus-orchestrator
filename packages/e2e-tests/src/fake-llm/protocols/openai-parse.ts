// packages/e2e-tests/src/fake-llm/protocols/openai-parse.ts
import type {
  CanonicalMessage,
  CanonicalRequest,
  CanonicalRole,
  CanonicalToolDef,
} from "../types.js";

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiMessage {
  role?: string;
  content?: unknown;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiTool {
  function?: { name?: string; description?: string };
}

interface OpenAiBody {
  model?: string;
  messages?: OpenAiMessage[];
  tools?: OpenAiTool[];
  stream?: boolean;
}

function extractPartText(part: unknown): string {
  if (typeof part === "string") return part;
  if (part && typeof part === "object" && "text" in part) {
    const { text } = part as { text?: unknown };
    return typeof text === "string" ? text : "";
  }
  return "";
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(extractPartText).join("");
  }
  return "";
}

function normaliseRole(role: string | undefined): CanonicalRole {
  if (role === "system" || role === "assistant" || role === "tool") return role;
  return "user";
}

export function parseOpenAiRequest(
  body: unknown,
  headers: Record<string, string>,
): CanonicalRequest {
  const parsed = (body ?? {}) as OpenAiBody;
  const rawMessages = parsed.messages ?? [];

  const toolNameById = new Map<string, string>();
  for (const message of rawMessages) {
    for (const call of message.tool_calls ?? []) {
      if (call.id && call.function?.name) {
        toolNameById.set(call.id, call.function.name);
      }
    }
  }

  const messages: CanonicalMessage[] = rawMessages.map((message) => {
    const role = normaliseRole(message.role);
    if (role === "tool") {
      return {
        role: "tool",
        text: flattenContent(message.content),
        toolName: message.tool_call_id
          ? toolNameById.get(message.tool_call_id)
          : undefined,
      };
    }
    return { role, text: flattenContent(message.content) };
  });

  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.text)
    .join("\n");

  const tools: CanonicalToolDef[] = (parsed.tools ?? []).map((tool) => ({
    name: tool.function?.name ?? "",
    description: tool.function?.description ?? "",
  }));

  return {
    protocol: "openai",
    model: parsed.model ?? "",
    system,
    messages,
    tools,
    stream: parsed.stream === true,
    rawBody: body,
    headers,
  };
}
