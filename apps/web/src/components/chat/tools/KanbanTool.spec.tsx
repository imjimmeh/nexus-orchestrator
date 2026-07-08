import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KanbanTool } from "./KanbanTool";
import type { ToolCallMetadata } from "../chat.types";

function buildToolCall(
  overrides: Partial<ToolCallMetadata> = {},
): ToolCallMetadata {
  return {
    type: "tool_call",
    toolName: "kanban.project_state",
    callId: "c1",
    status: "finished",
    summary: "",
    partialResults: [],
    isError: false,
    startedAt: 0,
    resultObj: {
      content: [{ type: "text", text: '{"items":3,"status":"orchestrating"}' }],
    },
    ...overrides,
  };
}

describe("KanbanTool", () => {
  it("labels with the namespaced method stripped", () => {
    render(<KanbanTool toolCall={buildToolCall()} />);
    expect(screen.getByText(/kanban · project_state/i)).toBeTruthy();
  });

  it("unwraps and pretty-prints the JSON result", () => {
    render(<KanbanTool toolCall={buildToolCall()} />);
    expect(screen.getByText(/"status": "orchestrating"/)).toBeTruthy();
  });

  it("renders the error message when the tool failed", () => {
    render(
      <KanbanTool
        toolCall={buildToolCall({
          isError: true,
          errorText: "lane_capacity_exhausted",
          resultObj: undefined,
        })}
      />,
    );
    expect(screen.getByText("lane_capacity_exhausted")).toBeTruthy();
  });
});
