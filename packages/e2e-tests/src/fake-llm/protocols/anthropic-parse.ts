// packages/e2e-tests/src/fake-llm/protocols/anthropic-parse.ts
import type {
  CanonicalMessage,
  CanonicalRequest,
  CanonicalRole,
  CanonicalToolDef,
} from "../types.js";

interface AnthropicBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

interface AnthropicMessage {
  role?: string;
  content?: unknown;
}

interface AnthropicTool {
  name?: string;
  description?: string;
}

interface AnthropicBody {
  model?: string;
  system?: unknown;
  messages?: AnthropicMessage[];
  tools?: AnthropicTool[];
  stream?: boolean;
}

function extractTextFromPart(part: unknown): string {
  if (part && typeof part === "object" && "text" in part) {
    const { text } = part as { text?: unknown };
    return typeof text === "string" ? text : "";
  }
  return "";
}

function flattenSystem(system: unknown): string {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system.map(extractTextFromPart).join("\n");
  }
  return "";
}

function toBlocks(content: unknown): AnthropicBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content as AnthropicBlock[];
  return [];
}

function flattenResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(extractTextFromPart).join("");
  }
  return "";
}

function normaliseRole(role: string | undefined): CanonicalRole {
  return role === "assistant" ? "assistant" : "user";
}

function buildToolNameIndex(
  rawMessages: AnthropicMessage[],
): Map<string, string> {
  const toolNameById = new Map<string, string>();
  for (const message of rawMessages) {
    for (const block of toBlocks(message.content)) {
      if (block.type === "tool_use" && block.id && block.name) {
        toolNameById.set(block.id, block.name);
      }
    }
  }
  return toolNameById;
}

function blockToMessage(
  block: AnthropicBlock,
  role: CanonicalRole,
  toolNameById: Map<string, string>,
): CanonicalMessage | null {
  if (block.type === "text") {
    return { role, text: block.text ?? "" };
  }
  if (block.type === "tool_use") {
    return { role: "assistant", text: "", toolName: block.name };
  }
  if (block.type === "tool_result") {
    return {
      role: "tool",
      text: flattenResultContent(block.content),
      toolName: block.tool_use_id
        ? toolNameById.get(block.tool_use_id)
        : undefined,
    };
  }
  return null;
}

export function parseAnthropicRequest(
  body: unknown,
  headers: Record<string, string>,
): CanonicalRequest {
  const parsed = (body ?? {}) as AnthropicBody;
  const rawMessages = parsed.messages ?? [];
  const toolNameById = buildToolNameIndex(rawMessages);

  const messages: CanonicalMessage[] = [];
  for (const message of rawMessages) {
    const role = normaliseRole(message.role);
    for (const block of toBlocks(message.content)) {
      const canonical = blockToMessage(block, role, toolNameById);
      if (canonical !== null) {
        messages.push(canonical);
      }
    }
  }

  const tools: CanonicalToolDef[] = (parsed.tools ?? []).map((tool) => ({
    name: tool.name ?? "",
    description: tool.description ?? "",
  }));

  return {
    protocol: "anthropic",
    model: parsed.model ?? "",
    system: flattenSystem(parsed.system),
    messages,
    tools,
    stream: parsed.stream === true,
    rawBody: body,
    headers,
  };
}
