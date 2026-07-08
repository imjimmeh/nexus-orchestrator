import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DelegateTool } from "./DelegateTool";
import type { ToolCallMetadata } from "../chat.types";

function buildToolCall(
  toolName: string,
  overrides: Partial<ToolCallMetadata> = {},
): ToolCallMetadata {
  return {
    type: "tool_call",
    toolName,
    callId: "c1",
    status: "finished",
    summary: "",
    partialResults: [],
    isError: false,
    startedAt: 0,
    argsObj: { task: "do the thing" },
    ...overrides,
  };
}

describe("DelegateTool", () => {
  it("renders delegate type label derived from toolName", () => {
    render(
      <MemoryRouter>
        <DelegateTool toolCall={buildToolCall("delegate_design_ingestion")} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/Design Ingestion/i).length).toBeGreaterThan(0);
  });

  it("renders task prompt", () => {
    render(
      <MemoryRouter>
        <DelegateTool
          toolCall={buildToolCall("delegate_roadmap_planning", {
            argsObj: { task: "Plan the Q3 roadmap" },
          })}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Plan the Q3 roadmap/i)).toBeTruthy();
  });

  it("renders open session link when result has chatSessionId", () => {
    render(
      <MemoryRouter>
        <DelegateTool
          toolCall={buildToolCall("delegate_rediscovery", {
            resultObj: { chatSessionId: "sess-42" },
          })}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /open delegate session/i });
    expect(link.getAttribute("href")).toContain("sess-42");
  });

  it("omits open session link when no chatSessionId", () => {
    render(
      <MemoryRouter>
        <DelegateTool toolCall={buildToolCall("delegate_rediscovery")} />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("link", { name: /open delegate session/i }),
    ).toBeNull();
  });

  it("shows failed status when isError", () => {
    render(
      <MemoryRouter>
        <DelegateTool
          toolCall={buildToolCall("delegate_rediscovery", {
            isError: true,
            errorText: "delegate crashed",
          })}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/failed/i)).toBeTruthy();
    expect(screen.getByText(/delegate crashed/i)).toBeTruthy();
  });

  it("renders header + badge without crashing when argsObj is undefined", () => {
    render(
      <MemoryRouter>
        <DelegateTool
          toolCall={buildToolCall("delegate_x", { argsObj: undefined })}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/delegate X/i)).toBeTruthy();
  });
});
