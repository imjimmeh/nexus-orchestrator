import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GenericTool } from "./GenericTool";
import type { ToolCallMetadata } from "../chat.types";

function buildToolCall(
  overrides: Partial<ToolCallMetadata> = {},
): ToolCallMetadata {
  return {
    type: "tool_call",
    toolName: "unknown_tool",
    callId: "call-1",
    status: "finished",
    summary: "unknown_tool · ✓",
    partialResults: [],
    isError: false,
    startedAt: 1000,
    ...overrides,
  };
}

describe("GenericTool", () => {
  it("renders tool name header", () => {
    render(
      <GenericTool toolCall={buildToolCall({ toolName: "mcp__foo__bar" })} />,
    );
    expect(screen.getByText("mcp__foo__bar")).toBeTruthy();
  });
  it("renders Args section when argsObj present", () => {
    render(
      <GenericTool toolCall={buildToolCall({ argsObj: { key: "value" } })} />,
    );
    expect(screen.getByText(/Args/i)).toBeTruthy();
    expect(screen.getByText(/"key"/)).toBeTruthy();
  });
  it("renders Result section when resultObj present and not error", () => {
    render(
      <GenericTool toolCall={buildToolCall({ resultObj: { ok: true } })} />,
    );
    expect(screen.getByText(/Result/i)).toBeTruthy();
    expect(screen.getByText(/"ok"/)).toBeTruthy();
  });
  it("renders Error section when isError and extracts message", () => {
    render(
      <GenericTool
        toolCall={buildToolCall({
          isError: true,
          errorText: "boom",
          resultObj: { message: "boom" },
        })}
      />,
    );
    expect(screen.getByText(/Error/i)).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();
  });
  it("renders raw result JSON in collapsible when error", () => {
    render(
      <GenericTool
        toolCall={buildToolCall({
          isError: true,
          errorText: "boom",
          resultObj: { message: "boom", detail: { code: 42 } },
        })}
      />,
    );
    expect(screen.getByText(/Error/i)).toBeTruthy();
    expect(screen.getByText(/"detail"/)).toBeTruthy();
  });
  it("extracts error message from resultObj when errorText is absent", () => {
    render(
      <GenericTool
        toolCall={buildToolCall({
          isError: true,
          resultObj: { message: "extracted from result" },
        })}
      />,
    );
    expect(screen.getByText("extracted from result")).toBeTruthy();
  });
});
