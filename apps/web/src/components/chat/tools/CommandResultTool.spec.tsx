import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommandResultTool } from "./CommandResultTool";
import type { ToolCallMetadata } from "../chat.types";

function buildToolCall(
  overrides: Partial<ToolCallMetadata> = {},
): ToolCallMetadata {
  return {
    type: "tool_call",
    toolName: "list_dir",
    callId: "c1",
    status: "finished",
    summary: "",
    partialResults: [],
    isError: false,
    startedAt: 0,
    argsObj: { path: "/workspace/src" },
    resultObj: { content: [{ type: "text", text: "a.ts\nb.ts" }] },
    ...overrides,
  };
}

describe("CommandResultTool", () => {
  it("shows tool name with the primary arg and the unwrapped output", () => {
    render(<CommandResultTool toolCall={buildToolCall()} />);
    expect(screen.getByText(/list_dir \/workspace\/src/i)).toBeTruthy();
    expect(screen.getByText(/a\.ts/i)).toBeTruthy();
  });

  it("prefers pattern/query args for grep-style tools", () => {
    render(
      <CommandResultTool
        toolCall={buildToolCall({
          toolName: "grep",
          argsObj: { pattern: "TODO", path: "/x" },
          resultObj: { content: [{ type: "text", text: "match" }] },
        })}
      />,
    );
    expect(screen.getByText(/grep TODO/i)).toBeTruthy();
  });

  it("renders header without output when result is empty", () => {
    render(
      <CommandResultTool toolCall={buildToolCall({ resultObj: undefined })} />,
    );
    expect(screen.getByText(/list_dir/i)).toBeTruthy();
  });
});
