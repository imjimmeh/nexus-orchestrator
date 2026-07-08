import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReadFileTool } from "./ReadFileTool";
import type { ToolCallMetadata } from "../chat.types";

function buildToolCall(
  overrides: Partial<ToolCallMetadata> = {},
): ToolCallMetadata {
  return {
    type: "tool_call",
    toolName: "read_file",
    callId: "c1",
    status: "finished",
    summary: "",
    partialResults: [],
    isError: false,
    startedAt: 0,
    argsObj: { path: "src/foo.ts" },
    resultObj: "hello\nworld\n",
    ...overrides,
  };
}

describe("ReadFileTool", () => {
  it("renders path header and content pre", () => {
    render(<ReadFileTool toolCall={buildToolCall()} />);
    expect(screen.getByText(/src\/foo\.ts/i)).toBeTruthy();
    expect(screen.getByText(/hello/i)).toBeTruthy();
  });

  it("renders range when present in argsObj", () => {
    render(
      <ReadFileTool
        toolCall={buildToolCall({
          argsObj: { path: "src/foo.ts", offset: 10, limit: 5 },
        })}
      />,
    );
    expect(screen.getByText(/src\/foo\.ts:10-14/i)).toBeTruthy();
  });

  it("shows truncation tag when result exceeds 8000 chars", () => {
    render(
      <ReadFileTool
        toolCall={buildToolCall({ resultObj: "x".repeat(9000) })}
      />,
    );
    expect(screen.getByText(/truncated/i)).toBeTruthy();
  });

  it("omits truncation tag when under cap", () => {
    render(
      <ReadFileTool toolCall={buildToolCall({ resultObj: "x".repeat(100) })} />,
    );
    expect(screen.queryByText(/truncated/i)).toBeNull();
  });

  it("handles undefined resultObj without crashing", () => {
    render(<ReadFileTool toolCall={buildToolCall({ resultObj: undefined })} />);
    expect(screen.getByText(/src\/foo\.ts/i)).toBeTruthy();
    expect(screen.queryByText(/truncated/i)).toBeNull();
  });

  it("falls back to <unknown> path when argsObj is undefined", () => {
    render(<ReadFileTool toolCall={buildToolCall({ argsObj: undefined })} />);
    expect(screen.getByText(/<unknown>/i)).toBeTruthy();
  });
});
