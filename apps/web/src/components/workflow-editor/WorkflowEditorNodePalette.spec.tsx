import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { WorkflowEditorNodePalette } from "./WorkflowEditorNodePalette";
import { JOB_TYPE_CONFIG } from "./nodes/node-types";
import type { JobType } from "./serialization/types";

const ALL_JOB_TYPES: JobType[] = [
  "execution",
  "invoke_workflow",
  "run_command",
  "emit_event",
  "http_webhook",
  "web_automation",
  "mcp_tool_call",
  "git_operation",
  "register_tool",
  "manage_tool_candidate",
];

describe("WorkflowEditorNodePalette", () => {
  it("renders all 10 job type items as draggable elements", () => {
    render(<WorkflowEditorNodePalette />);

    for (const jobType of ALL_JOB_TYPES) {
      const label = JOB_TYPE_CONFIG[jobType].label;
      const matches = screen.getAllByText(label);
      const itemSpan = matches.find((el) => el.tagName === "SPAN");
      expect(itemSpan).toBeTruthy();

      const draggable = itemSpan?.closest("[draggable]");
      expect(draggable).toBeTruthy();
      expect(draggable?.getAttribute("draggable")).toBe("true");
    }
  });

  it("renders group headings for Execution, Integration, and Utility", () => {
    render(<WorkflowEditorNodePalette />);

    const headings = screen.getAllByRole("heading");
    const headingTexts = headings.map((h) => h.textContent);

    expect(headingTexts).toContain("Execution");
    expect(headingTexts).toContain("Integration");
    expect(headingTexts).toContain("Utility");
  });

  it("renders items under correct group headings", () => {
    render(<WorkflowEditorNodePalette />);

    const executionHeading = screen.getByRole("heading", {
      name: "Execution",
    });
    const execSection = executionHeading.closest("section");
    expect(execSection).toBeTruthy();

    const integrationHeading = screen.getByRole("heading", {
      name: "Integration",
    });
    const intSection = integrationHeading.closest("section");
    expect(intSection).toBeTruthy();

    const utilityHeading = screen.getByRole("heading", { name: "Utility" });
    const utilSection = utilityHeading.closest("section");
    expect(utilSection).toBeTruthy();
  });

  it("labels in items match JOB_TYPE_CONFIG labels", () => {
    render(<WorkflowEditorNodePalette />);

    for (const jobType of ALL_JOB_TYPES) {
      const expectedLabel = JOB_TYPE_CONFIG[jobType].label;
      const matches = screen.getAllByText(expectedLabel);
      const itemSpan = matches.find((el) => el.tagName === "SPAN");
      expect(itemSpan).toBeTruthy();
    }
  });

  it("sets correct dataTransfer on dragStart for each draggable item", () => {
    render(<WorkflowEditorNodePalette />);

    for (const jobType of ALL_JOB_TYPES) {
      const label = JOB_TYPE_CONFIG[jobType].label;
      const matches = screen.getAllByText(label);
      const itemSpan = matches.find((el) => el.tagName === "SPAN");
      const item = itemSpan?.closest("[draggable]") as HTMLElement | null;
      if (!item) throw new Error("item not found");

      const setData = vi.fn();
      const dragStartEvent = new Event("dragstart", {
        bubbles: true,
      }) as DragEvent;
      Object.defineProperty(dragStartEvent, "dataTransfer", {
        get: () => ({ setData, effectAllowed: "" }),
      });

      fireEvent(item, dragStartEvent);

      expect(setData).toHaveBeenCalledWith("application/reactflow", jobType);
    }
  });

  it("sets effectAllowed to move on dragStart", () => {
    render(<WorkflowEditorNodePalette />);

    const matches = screen.getAllByText("Execution");
    const itemSpan = matches.find((el) => el.tagName === "SPAN");
    const item = itemSpan?.closest("[draggable]") as HTMLElement | null;
    if (!item) throw new Error("item not found");
    const setData = vi.fn();

    const dragStartEvent = new Event("dragstart", {
      bubbles: true,
    }) as DragEvent;
    let capturedEffectAllowed = "";
    Object.defineProperty(dragStartEvent, "dataTransfer", {
      get: () => ({
        setData,
        get effectAllowed() {
          return capturedEffectAllowed;
        },
        set effectAllowed(value: string) {
          capturedEffectAllowed = value;
        },
      }),
    });

    fireEvent(item, dragStartEvent);

    expect(capturedEffectAllowed).toBe("move");
  });

  it("toggles between expanded and collapsed states", async () => {
    const user = userEvent.setup();
    render(<WorkflowEditorNodePalette />);

    const toggleButton = screen.getByRole("button", {
      name: /collapse palette/i,
    });
    expect(toggleButton).toBeTruthy();

    expect(screen.getByRole("heading", { name: "Execution" })).toBeTruthy();

    await user.click(toggleButton);

    expect(screen.queryByRole("heading", { name: "Execution" })).toBeNull();

    const expandButton = screen.getByRole("button", {
      name: /expand palette/i,
    });
    expect(expandButton).toBeTruthy();

    await user.click(expandButton);

    expect(screen.getByRole("heading", { name: "Execution" })).toBeTruthy();
  });

  it("shows icons for all items", () => {
    const { container } = render(<WorkflowEditorNodePalette />);

    const svgElements = container.querySelectorAll("svg");
    expect(svgElements.length).toBeGreaterThanOrEqual(10);
  });
});
