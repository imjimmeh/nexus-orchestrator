import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EditFileTool } from "./EditFileTool";
import type { ToolCallMetadata } from "../chat.types";

function buildToolCall(
  overrides: Partial<ToolCallMetadata> = {},
): ToolCallMetadata {
  return {
    type: "tool_call",
    toolName: "edit_file",
    callId: "c1",
    status: "finished",
    summary: "",
    partialResults: [],
    isError: false,
    startedAt: 0,
    argsObj: { path: "src/foo.ts", oldString: "a\nb\nc", newString: "a\nB\nc" },
    ...overrides,
  };
}

describe("EditFileTool", () => {
  it("renders path header and shows added/removed lines", () => {
    render(<EditFileTool toolCall={buildToolCall()} />);
    expect(screen.getByText(/src\/foo\.ts/i)).toBeTruthy();
    const adds = screen.getAllByText(/^\+ B$/);
    const dels = screen.getAllByText(/^- b$/);
    expect(adds.length).toBe(1);
    expect(dels.length).toBe(1);
  });
  it("renders the harness edits[] shape (oldText/newText)", () => {
    render(
      <EditFileTool
        toolCall={buildToolCall({
          argsObj: {
            path: "src/foo.ts",
            edits: [{ oldText: "a\nb\nc", newText: "a\nB\nc" }],
          },
        })}
      />,
    );
    expect(screen.getByText(/src\/foo\.ts/i)).toBeTruthy();
    expect(screen.getAllByText(/^\+ B$/).length).toBe(1);
    expect(screen.getAllByText(/^- b$/).length).toBe(1);
  });
  it("shows replaceAll badge when args.replaceAll is true", () => {
    render(
      <EditFileTool
        toolCall={buildToolCall({
          argsObj: {
            path: "x",
            oldString: "a",
            newString: "b",
            replaceAll: true,
          },
        })}
      />,
    );
    expect(screen.getByText(/replaceAll/i)).toBeTruthy();
  });
  it("shows replaced count from result when available", () => {
    render(
      <EditFileTool
        toolCall={buildToolCall({
          argsObj: {
            path: "x",
            oldString: "a",
            newString: "b",
            replaceAll: true,
          },
          resultObj: { replaced: 5 },
        })}
      />,
    );
    expect(screen.getByText("replaceAll (5)")).toBeTruthy();
  });
  it("renders error strip when isError and oldString present", () => {
    render(
      <EditFileTool
        toolCall={buildToolCall({
          isError: true,
          errorText: "oldString not found",
          argsObj: {
            path: "x",
            oldString: "old snippet",
            newString: "new snippet",
          },
        })}
      />,
    );
    expect(screen.getByText("oldString not found")).toBeTruthy();
    expect(screen.getByText("- old snippet")).toBeTruthy();
  });
  it("falls back to <unknown> path when argsObj is undefined", () => {
    render(<EditFileTool toolCall={buildToolCall({ argsObj: undefined })} />);
    expect(screen.getByText(/<unknown>/i)).toBeTruthy();
  });
  it("extracts error message from resultObj when errorText is absent", () => {
    render(
      <EditFileTool
        toolCall={buildToolCall({
          isError: true,
          argsObj: {
            path: "x",
            oldString: "old snippet",
            newString: "new snippet",
          },
          resultObj: { message: "extracted from result" },
        })}
      />,
    );
    expect(screen.getByText("extracted from result")).toBeTruthy();
  });
});
