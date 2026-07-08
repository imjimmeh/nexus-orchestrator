/**
 * Scripted fake for the @anthropic-ai/claude-agent-sdk `query` function.
 *
 * The CC engine calls `query({ prompt, options })` which returns an
 * AsyncIterable<unknown>.  The ClaudeCodeSession consumes this generator and
 * passes each message through ClaudeEventMapper, which expects SDK-shaped
 * message objects.
 *
 * These helpers produce async generators that yield the SDK message shapes
 * needed to exercise each conformance case.
 */

import type { SdkMessage } from "./claude-code.types.js";

export type {
  SdkAssistantMessage,
  SdkUserMessage,
  SdkResultMessage,
  SdkMessage,
} from "./claude-code.types.js";

// ---------------------------------------------------------------------------
// Scripted tool call identifiers used across conformance tests
// ---------------------------------------------------------------------------

export const CC_SCRIPTED_TOOL_CALL_ID = "cc-tool-use-1";
export const CC_SCRIPTED_TOOL_NAME = "list_files";

// ---------------------------------------------------------------------------
// Generator factories
// ---------------------------------------------------------------------------

/**
 * Full happy-path sequence:
 *   assistant (tool_use) → user (tool_result) → result (success)
 *
 * Exercises C3 (turn_start emitted on first assistant msg),
 * C4 (tool_execution_start), C5 (tool_execution_end), C6 (agent_end).
 */
export async function* makeFullSessionGenerator(): AsyncGenerator<SdkMessage> {
  await Promise.resolve();
  yield {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: CC_SCRIPTED_TOOL_CALL_ID,
          name: CC_SCRIPTED_TOOL_NAME,
          input: { path: "/tmp" },
        },
      ],
    },
  };
  yield {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: CC_SCRIPTED_TOOL_CALL_ID,
          content: ["file-a.ts", "file-b.ts"],
          is_error: false,
        },
      ],
    },
  };
  yield {
    type: "result",
    subtype: "success",
    result: "Here are the files.",
    usage: { output_tokens: 10 },
  };
}

/**
 * Sequence that never uses a tool — used for C7 (governance deny).
 * If governance denies the tool, the engine never calls it, so only an
 * assistant text reply and result are produced (no tool_use).
 */
export async function* makeDenySessionGenerator(): AsyncGenerator<SdkMessage> {
  await Promise.resolve();
  yield {
    type: "result",
    subtype: "error",
    result: "Tool denied by governance.",
  };
}

/**
 * Minimal sequence — just a result message. Used for bare C2 structural tests
 * when no event data is needed.
 */
export async function* makeMinimalSessionGenerator(): AsyncGenerator<SdkMessage> {
  await Promise.resolve();
  yield {
    type: "result",
    subtype: "success",
    result: "Done.",
  };
}
