import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ManageTodoListTool } from "./ManageTodoListTool";
import type { ToolCallMetadata } from "../chat.types";

function buildToolCall(
  overrides: Partial<ToolCallMetadata> = {},
): ToolCallMetadata {
  return {
    type: "tool_call",
    toolName: "manage_todo_list",
    callId: "c1",
    status: "finished",
    summary: "",
    partialResults: [],
    isError: false,
    startedAt: 0,
    argsObj: {
      todo_list: [
        { id: "1", title: "Write tests", status: "completed" },
        { id: "2", title: "Refactor", status: "in-progress" },
        { id: "3", title: "Docs", status: "not-started" },
      ],
    },
    ...overrides,
  };
}

describe("ManageTodoListTool", () => {
  it("renders each todo row from the real todo_list/title shape", () => {
    render(<ManageTodoListTool toolCall={buildToolCall()} />);
    expect(screen.getByText("Write tests")).toBeTruthy();
    expect(screen.getByText("Refactor")).toBeTruthy();
    expect(screen.getByText("Docs")).toBeTruthy();
  });

  it("shows the todo count in the header", () => {
    render(<ManageTodoListTool toolCall={buildToolCall()} />);
    expect(screen.getByText(/3 todos/i)).toBeTruthy();
  });

  it("uses correct glyph per hyphenated status", () => {
    const { container } = render(
      <ManageTodoListTool toolCall={buildToolCall()} />,
    );
    const items = container.querySelectorAll("li");
    expect(items[0]?.textContent).toMatch(/^✓/);
    expect(items[0]?.textContent).toContain("Write tests");
    expect(items[1]?.textContent).toMatch(/^●/);
    expect(items[1]?.textContent).toContain("Refactor");
    expect(items[2]?.textContent).toMatch(/^□/);
    expect(items[2]?.textContent).toContain("Docs");
  });

  it("falls back to the native todos/content shape", () => {
    render(
      <ManageTodoListTool
        toolCall={buildToolCall({
          argsObj: {
            todos: [
              {
                content: "Native todo",
                status: "in_progress",
                priority: "high",
              },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText("Native todo")).toBeTruthy();
    expect(screen.getByText(/high/i)).toBeTruthy();
  });

  it("renders empty state when the list is empty", () => {
    render(
      <ManageTodoListTool
        toolCall={buildToolCall({ argsObj: { todo_list: [] } })}
      />,
    );
    expect(screen.getByText(/no todos/i)).toBeTruthy();
  });

  it("falls back to empty state when argsObj is undefined", () => {
    render(
      <ManageTodoListTool toolCall={buildToolCall({ argsObj: undefined })} />,
    );
    expect(screen.getByText(/no todos/i)).toBeTruthy();
  });
});
