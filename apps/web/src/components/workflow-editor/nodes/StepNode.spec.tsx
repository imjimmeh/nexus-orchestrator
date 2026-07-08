import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { StepNode } from "./StepNode";
import type {
  StepNodeData,
  StepNode as StepNodeType,
} from "../serialization/types";

function renderWithProvider(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

function createProps(overrides: Partial<StepNodeType> = {}) {
  return {
    id: "step-1",
    type: "step" as const,
    position: { x: 0, y: 0 },
    data: {
      label: "My Agent Step",
      stepType: "agent" as const,
      stepId: "step-1",
      parentJobId: "job-1",
      prompt: "Write code",
    } satisfies StepNodeData,
    width: 160,
    height: 80,
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    ...overrides,
  };
}

describe("StepNode", () => {
  it("renders the step type label", () => {
    renderWithProvider(<StepNode {...createProps()} />);

    expect(screen.getByText("Agent")).toBeTruthy();
  });

  it("renders the step label from data", () => {
    renderWithProvider(<StepNode {...createProps()} />);

    expect(screen.getByText("My Agent Step")).toBeTruthy();
  });

  it("renders the step ID", () => {
    renderWithProvider(<StepNode {...createProps()} />);

    expect(screen.getByText("step-1")).toBeTruthy();
  });

  it("does not duplicate the step ID when the label matches", () => {
    renderWithProvider(
      <StepNode
        {...createProps({
          data: {
            label: "step-1",
            stepType: "agent",
            stepId: "step-1",
            parentJobId: "job-1",
            prompt: "Write code",
          } satisfies StepNodeData,
        })}
      />,
    );

    expect(screen.getAllByText("step-1").length).toBe(1);
  });

  it("renders a one-line preview of prompt when available", () => {
    renderWithProvider(<StepNode {...createProps()} />);

    expect(screen.getByText("Write code")).toBeTruthy();
    expect(screen.getByText("Write code").className).toContain("truncate");
  });

  it("renders a one-line preview of command when available", () => {
    renderWithProvider(
      <StepNode
        {...createProps({
          data: {
            label: "Command Step",
            stepType: "run_command",
            stepId: "cmd-step",
            parentJobId: "job-1",
            command: "npm run build",
          } satisfies StepNodeData,
        })}
      />,
    );

    expect(screen.getByText("Command")).toBeTruthy();
    expect(screen.getByText("npm run build")).toBeTruthy();
  });

  it("renders variable names for set_variable step", () => {
    renderWithProvider(
      <StepNode
        {...createProps({
          data: {
            label: "Set Var Step",
            stepType: "set_variable",
            stepId: "var-step",
            parentJobId: "job-1",
            variables: { FOO: "bar", BAZ: "qux" },
          } satisfies StepNodeData,
        })}
      />,
    );

    expect(screen.getByText("Set Variable")).toBeTruthy();
    expect(screen.getByText("FOO, BAZ")).toBeTruthy();
  });

  it("uses the compact shared card sizing", () => {
    const { container } = renderWithProvider(<StepNode {...createProps()} />);

    const nodeDiv = container.firstElementChild as HTMLElement;
    expect(nodeDiv?.className).toContain("min-w-[160px]");
  });

  it("renders target and source Handles", () => {
    const { container } = renderWithProvider(<StepNode {...createProps()} />);

    const targetHandle = container.querySelector('[data-handlepos="left"]');
    const sourceHandle = container.querySelector('[data-handlepos="right"]');
    expect(targetHandle).toBeTruthy();
    expect(sourceHandle).toBeTruthy();
  });
});
