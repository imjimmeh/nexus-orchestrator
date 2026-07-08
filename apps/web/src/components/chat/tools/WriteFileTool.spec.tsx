import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { WriteFileTool } from "./WriteFileTool";
import type { ToolCallMetadata } from "../chat.types";

function buildToolCall(
  overrides: Partial<ToolCallMetadata> = {},
): ToolCallMetadata {
  return {
    type: "tool_call",
    toolName: "write_file",
    callId: "c1",
    status: "finished",
    summary: "",
    partialResults: [],
    isError: false,
    startedAt: 0,
    argsObj: { path: "src/new.ts" },
    ...overrides,
  };
}

describe("WriteFileTool", () => {
  it("renders path header", () => {
    render(<WriteFileTool toolCall={buildToolCall()} />);
    expect(screen.getByText(/src\/new\.ts/i)).toBeTruthy();
  });
  it("renders content preview under cap", () => {
    render(
      <WriteFileTool
        toolCall={buildToolCall({
          argsObj: { path: "x.ts", content: "const x = 1;" },
        })}
      />,
    );
    expect(screen.getByText(/const x = 1/i)).toBeTruthy();
  });
  it("truncates and offers 'show full file' toggle over cap", async () => {
    const user = userEvent.setup();
    const big = "x".repeat(9000);
    const { container } = render(
      <WriteFileTool
        toolCall={buildToolCall({ argsObj: { path: "x.ts", content: big } })}
      />,
    );
    const pre = container.querySelector("pre");
    expect(pre?.textContent?.length).toBeLessThan(big.length);
    const toggle = screen.getByRole("button", { name: /show full file/i });
    await user.click(toggle);
    const preAfter = container.querySelector("pre");
    expect((preAfter?.textContent ?? "").length).toBeGreaterThanOrEqual(
      big.length,
    );
    const hideToggle = screen.getByRole("button", {
      name: /hide full file/i,
    });
    await user.click(hideToggle);
    const collapsed = container.querySelector("pre");
    expect((collapsed?.textContent ?? "").length).toBeLessThan(big.length);
  });

  it("falls back to <unknown> path when argsObj is undefined", () => {
    render(<WriteFileTool toolCall={buildToolCall({ argsObj: undefined })} />);
    expect(screen.getByText(/<unknown>/i)).toBeTruthy();
  });

  it("renders empty body and omits toggle when content is absent", () => {
    const { container } = render(
      <WriteFileTool toolCall={buildToolCall({ argsObj: { path: "x.ts" } })} />,
    );
    expect(container.querySelector("pre")?.textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
