import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StepProperties } from "./StepProperties";
import { useWorkflowEditorStore } from "../hooks/useWorkflowEditorStore";
import type { StepNode } from "../serialization/types";

vi.mock("@/hooks/useHarnesses", () => ({
  useHarnesses: () => ({
    data: [
      { harnessId: "pi", displayName: "PI" },
      { harnessId: "claude-code", displayName: "Claude Code" },
    ],
    isLoading: false,
  }),
}));

function createAgentStepNode(
  overrides: Partial<StepNode["data"]> = {},
  id = "step-1",
): StepNode {
  return {
    id,
    type: "step",
    position: { x: 0, y: 0 },
    data: {
      label: "Test Step",
      stepType: "agent",
      stepId: "step-1",
      parentJobId: "job-1",
      ...overrides,
    },
  };
}

describe("step harness override", () => {
  beforeEach(() => {
    useWorkflowEditorStore.getState().resetState({});
  });

  it("renders a harness selector for agent steps", () => {
    useWorkflowEditorStore.setState({
      selectedElementId: "step-1",
      nodes: [createAgentStepNode({ stepType: "agent" })],
    });

    render(<StepProperties />);

    expect(
      screen.getByRole("combobox", { name: "Harness Override" }),
    ).toBeTruthy();
  });

  it("shows inherit default option in the harness selector", () => {
    useWorkflowEditorStore.setState({
      selectedElementId: "step-1",
      nodes: [createAgentStepNode({ stepType: "agent" })],
    });

    render(<StepProperties />);

    const combo = screen.getByRole("combobox", { name: "Harness Override" });
    expect(combo.textContent).toMatch(/inherit/i);
  });

  it("does not render harness selector for non-agent steps", () => {
    useWorkflowEditorStore.setState({
      selectedElementId: "step-1",
      nodes: [createAgentStepNode({ stepType: "run_command" })],
    });

    render(<StepProperties />);

    expect(
      screen.queryByRole("combobox", { name: "Harness Override" }),
    ).toBeNull();
  });
});
