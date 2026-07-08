// packages/e2e-tests/src/fake-llm/protocols/anthropic-serialize.ts
export type { AnthropicMessageResponse } from "./anthropic-serialize.types.js";
import type { AnthropicMessageResponse } from "./anthropic-serialize.types.js";
import { isToolCall } from "../scenario.js";
import type { Turn } from "../types.js";

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    };

function messageId(seed: number): string {
  return `msg_${String(seed).padStart(8, "0")}`;
}

function toContentBlocks(turns: Turn[]): AnthropicContentBlock[] {
  return turns.map((turn, index) =>
    turn.kind === "tool_call"
      ? {
          type: "tool_use",
          id: `toolu_${String(index).padStart(4, "0")}`,
          name: turn.toolName,
          input: turn.arguments,
        }
      : { type: "text", text: turn.text },
  );
}

export function serializeAnthropicResponse(
  turns: Turn[],
  model: string,
  seed: number,
): AnthropicMessageResponse {
  const content = toContentBlocks(turns);
  return {
    id: messageId(seed),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: turns.some(isToolCall) ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}

export function serializeAnthropicSse(
  turns: Turn[],
  model: string,
  seed: number,
): string {
  const id = messageId(seed);
  const content = toContentBlocks(turns);
  const stopReason: "end_turn" | "tool_use" = turns.some(isToolCall)
    ? "tool_use"
    : "end_turn";
  const events: string[] = [];
  const emit = (event: string, data: unknown): void => {
    events.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  emit("message_start", {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 0 },
    },
  });

  content.forEach((block, index) => {
    if (block.type === "text") {
      emit("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      emit("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: block.text },
      });
    } else {
      emit("content_block_start", {
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: {},
        },
      });
      emit("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify(block.input),
        },
      });
    }
    emit("content_block_stop", { type: "content_block_stop", index });
  });

  emit("message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 20 },
  });
  events.push(
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  );
  return events.join("");
}
