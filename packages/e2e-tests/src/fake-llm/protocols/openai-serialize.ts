// packages/e2e-tests/src/fake-llm/protocols/openai-serialize.ts
export type { OpenAiCompletion } from "./openai-serialize.types.js";
import type { OpenAiCompletion } from "./openai-serialize.types.js";
import { isText, isToolCall } from "../scenario.js";
import type { Turn } from "../types.js";

const CREATED = 1_700_000_000;

interface OpenAiToolCallOut {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

function completionId(seed: number): string {
  return `chatcmpl-${String(seed).padStart(8, "0")}`;
}

function toToolCalls(turns: Turn[]): OpenAiToolCallOut[] {
  return turns.filter(isToolCall).map((turn, index) => ({
    id: `call_${String(index).padStart(4, "0")}`,
    type: "function",
    function: {
      name: turn.toolName,
      arguments: JSON.stringify(turn.arguments),
    },
  }));
}

export function serializeOpenAiResponse(
  turns: Turn[],
  model: string,
  seed: number,
): OpenAiCompletion {
  const toolCalls = toToolCalls(turns);
  const textTurn = turns.find(isText);

  if (toolCalls.length > 0) {
    return {
      id: completionId(seed),
      object: "chat.completion",
      created: CREATED,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: null, tool_calls: toolCalls },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    };
  }

  return {
    id: completionId(seed),
    object: "chat.completion",
    created: CREATED,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: textTurn ? textTurn.text : "" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

export function serializeOpenAiSse(
  turns: Turn[],
  model: string,
  seed: number,
): string {
  const id = completionId(seed);
  const toolCalls = toToolCalls(turns);
  const textTurn = turns.find(isText);
  const lines: string[] = [];
  const push = (payload: unknown): void => {
    lines.push(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const base = { id, object: "chat.completion.chunk", created: CREATED, model };

  if (toolCalls.length === 0 && textTurn) {
    push({
      ...base,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: textTurn.text },
          finish_reason: null,
        },
      ],
    });
  }

  toolCalls.forEach((call, index) => {
    push({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                id: call.id,
                type: "function",
                function: { name: call.function.name, arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    push({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index, function: { arguments: call.function.arguments } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
  });

  push({
    ...base,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
      },
    ],
  });
  lines.push("data: [DONE]\n\n");
  return lines.join("");
}
