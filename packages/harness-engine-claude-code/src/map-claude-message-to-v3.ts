import type {
  V3NodePayload,
  V3ContentBlock,
  V3Usage,
} from "@nexus/harness-runtime";

interface AnthropicTextBlock {
  type: "text";
  text: string;
}
interface AnthropicThinkingBlock {
  type: "thinking";
  thinking: string;
}
interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}
type AnthropicBlock =
  | AnthropicTextBlock
  | AnthropicThinkingBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | { type: string };

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface SdkAssistant {
  type: "assistant";
  message: {
    content: AnthropicBlock[];
    id?: string;
    model?: string;
    stop_reason?: string;
    usage?: AnthropicUsage;
  };
}
interface SdkUser {
  type: "user";
  message: { content: AnthropicBlock[] };
}
type SdkMessage = SdkAssistant | SdkUser | { type: string };

function toV3Usage(u: AnthropicUsage | undefined): V3Usage | undefined {
  if (!u) return undefined;
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function stringifyToolResult(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

/**
 * Translates Anthropic Claude Agent SDK stream messages into pi-compatible v3
 * node payloads. Stateful only for the tool_use id -> tool name cache, mirroring
 * ClaudeEventMapper. Pure with respect to ids/timestamps (the writer owns those).
 */
export class ClaudeV3Mapper {
  private readonly toolNames = new Map<string, string>();

  constructor(private readonly ctx: { provider: string; model: string }) {}

  map(msg: unknown): V3NodePayload[] {
    const message = msg as SdkMessage;

    if (message.type === "assistant") {
      const { message: m } = message as SdkAssistant;
      const content: V3ContentBlock[] = [];
      for (const block of m.content) {
        if (block.type === "text") {
          content.push({
            type: "text",
            text: (block as AnthropicTextBlock).text,
          });
        } else if (block.type === "thinking") {
          content.push({
            type: "text",
            text: `<think>\n${(block as AnthropicThinkingBlock).thinking}\n</think>`,
          });
        } else if (block.type === "tool_use") {
          const tu = block as AnthropicToolUseBlock;
          this.toolNames.set(tu.id, tu.name);
          content.push({
            type: "toolCall",
            id: tu.id,
            name: tu.name,
            arguments: tu.input,
          });
        }
      }
      return [
        {
          type: "message",
          message: {
            role: "assistant",
            content,
            provider: this.ctx.provider,
            model: m.model ?? this.ctx.model,
            usage: toV3Usage(m.usage),
            stopReason: m.stop_reason,
            responseId: m.id,
          },
        },
      ];
    }

    if (message.type === "user") {
      const { message: m } = message as SdkUser;
      const nodes: V3NodePayload[] = [];
      const textBlocks: V3ContentBlock[] = [];
      for (const block of m.content) {
        if (block.type === "tool_result") {
          const tr = block as AnthropicToolResultBlock;
          nodes.push({
            type: "message",
            message: {
              role: "toolResult",
              toolCallId: tr.tool_use_id,
              toolName: this.toolNames.get(tr.tool_use_id) ?? "unknown",
              content: [
                { type: "text", text: stringifyToolResult(tr.content) },
              ],
            },
          });
        } else if (block.type === "text") {
          textBlocks.push({
            type: "text",
            text: (block as AnthropicTextBlock).text,
          });
        }
      }
      if (textBlocks.length) {
        nodes.push({
          type: "message",
          message: { role: "user", content: textBlocks },
        });
      }
      return nodes;
    }

    return [];
  }
}
