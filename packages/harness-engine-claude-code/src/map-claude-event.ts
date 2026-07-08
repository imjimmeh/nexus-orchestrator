import type { CanonicalSessionEvent } from "@nexus/core";

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}

type ContentBlock = ToolUseBlock | ToolResultBlock | { type: string };

interface AssistantMessage {
  type: "assistant";
  message: { content: ContentBlock[] };
}

interface UserMessage {
  type: "user";
  message: { content: ContentBlock[] };
}

interface ResultMessage {
  type: "result";
  subtype: string;
  result: string;
  usage?: { output_tokens?: number };
}

type SdkMessage =
  | AssistantMessage
  | UserMessage
  | ResultMessage
  | { type: string };

/**
 * Maps SDK message-stream events to CanonicalSessionEvent arrays.
 *
 * Maintains a toolName cache keyed by tool_use id so that tool_result blocks
 * (which carry only the id) can include the matching toolName.
 */
export class ClaudeEventMapper {
  private readonly toolNames = new Map<string, string>();
  private turnStarted = false;

  constructor(private readonly stepId: string) {}

  map(msg: unknown): CanonicalSessionEvent[] {
    const message = msg as SdkMessage;
    const events: CanonicalSessionEvent[] = [];

    if (message.type === "assistant") {
      if (!this.turnStarted) {
        this.turnStarted = true;
        events.push({ type: "turn_start", stepId: this.stepId });
      }
      const assistantMsg = message as AssistantMessage;
      for (const block of assistantMsg.message.content) {
        if (block.type === "tool_use") {
          const toolUse = block as ToolUseBlock;
          this.toolNames.set(toolUse.id, toolUse.name);
          events.push({
            type: "tool_execution_start",
            stepId: this.stepId,
            toolCallId: toolUse.id,
            toolName: toolUse.name,
            args: toolUse.input,
          });
        }
      }
    } else if (message.type === "user") {
      // The Anthropic Messages API places tool_result blocks inside user messages.
      const userMsg = message as UserMessage;
      for (const block of userMsg.message.content) {
        if (block.type === "tool_result") {
          const toolResult = block as ToolResultBlock;
          const toolName =
            this.toolNames.get(toolResult.tool_use_id) ?? "unknown";
          events.push({
            type: "tool_execution_end",
            stepId: this.stepId,
            toolCallId: toolResult.tool_use_id,
            toolName,
            result: toolResult.content,
            isError: toolResult.is_error ?? false,
          });
        }
      }
    } else if (message.type === "result") {
      const result = message as ResultMessage;
      const ok = result.subtype === "success";
      events.push({
        type: "agent_end",
        stepId: this.stepId,
        output: {
          ok,
          response: result.result,
          stopReason: result.subtype,
          usage: result.usage,
        },
      });
    }

    return events;
  }
}
