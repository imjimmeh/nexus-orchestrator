import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BashTool } from "./BashTool";
import type { ToolCallMetadata } from "../chat.types";

function buildToolCall(
  overrides: Partial<ToolCallMetadata> = {},
): ToolCallMetadata {
  return {
    type: "tool_call",
    toolName: "bash",
    callId: "c1",
    status: "finished",
    summary: "",
    partialResults: [],
    isError: false,
    startedAt: 0,
    argsObj: { command: "ls" },
    resultObj: { stdout: "file1\nfile2\n", exitCode: 0 },
    ...overrides,
  };
}

describe("BashTool", () => {
  it("renders command header + stdout + exit 0 pill", () => {
    render(<BashTool toolCall={buildToolCall()} />);
    expect(screen.getByText(/\$ ls/i)).toBeTruthy();
    expect(screen.getByText(/file1/i)).toBeTruthy();
    expect(screen.getByText(/exit: 0/i)).toBeTruthy();
  });
  it("renders non-zero exit pill amber", () => {
    render(
      <BashTool
        toolCall={buildToolCall({
          resultObj: { stdout: "", stderr: "boom", exitCode: 2 },
        })}
      />,
    );
    expect(screen.getByText(/exit: 2/i)).toBeTruthy();
    expect(screen.getByText(/boom/i)).toBeTruthy();
  });
  it("streams partialResults while status is updated", () => {
    render(
      <BashTool
        toolCall={buildToolCall({
          status: "updated",
          partialResults: ["out1\n", "out2\n"],
          resultObj: undefined,
        })}
      />,
    );
    expect(screen.getByText(/out1/i)).toBeTruthy();
    expect(screen.getByText(/out2/i)).toBeTruthy();
    expect(screen.queryByText(/exit:/i)).toBeNull();
  });
  it("shows truncation tag over 200 rows", () => {
    const big = Array.from({ length: 250 }, (_, i) => `line${i}`).join("\n");
    render(
      <BashTool
        toolCall={buildToolCall({ resultObj: { stdout: big, exitCode: 0 } })}
      />,
    );
    expect(screen.getByText(/truncated/i)).toBeTruthy();
  });
  it("falls back to <unknown> command when argsObj is undefined", () => {
    render(<BashTool toolCall={buildToolCall({ argsObj: undefined })} />);
    expect(screen.getByText(/<unknown>/i)).toBeTruthy();
  });
  it("renders red error pill glyph when isError is true and status finished", () => {
    render(
      <BashTool
        toolCall={buildToolCall({
          isError: true,
          status: "finished",
          resultObj: { stdout: "", exitCode: 1 },
        })}
      />,
    );
    expect(screen.getByText("\u2717")).toBeTruthy();
    expect(screen.getByText(/exit: 1/i)).toBeTruthy();
  });
});
