import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { JobNode } from "./JobNode";
import type {
  JobNodeData,
  JobNode as JobNodeType,
} from "../serialization/types";

function renderWithProvider(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

function createProps(overrides: Partial<JobNodeType> = {}) {
  return {
    id: "job-1",
    type: "job" as const,
    position: { x: 0, y: 0 },
    data: {
      label: "My Execution Job",
      jobType: "execution" as const,
      jobId: "exec-1",
    } satisfies JobNodeData,
    width: 210,
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

describe("JobNode", () => {
  it("renders the job type label", () => {
    renderWithProvider(<JobNode {...createProps()} />);

    expect(screen.getByText("Execution")).toBeTruthy();
  });

  it("renders the job label from data", () => {
    renderWithProvider(<JobNode {...createProps()} />);

    expect(screen.getByText("My Execution Job")).toBeTruthy();
  });

  it("renders the job ID", () => {
    renderWithProvider(<JobNode {...createProps()} />);

    expect(screen.getByText("exec-1")).toBeTruthy();
  });

  it("does not duplicate the job ID when the label matches", () => {
    renderWithProvider(
      <JobNode
        {...createProps({
          data: {
            label: "exec-1",
            jobType: "execution",
            jobId: "exec-1",
          } satisfies JobNodeData,
        })}
      />,
    );

    expect(screen.getAllByText("exec-1").length).toBe(1);
  });

  it("renders job tier when present", () => {
    renderWithProvider(
      <JobNode
        {...createProps({
          data: {
            label: "My Execution Job",
            jobType: "execution",
            jobId: "exec-1",
            tier: "primary",
          } satisfies JobNodeData,
        })}
      />,
    );

    expect(screen.getByText("Tier: primary")).toBeTruthy();
  });

  it("renders step count for execution jobs", () => {
    renderWithProvider(
      <JobNode
        {...createProps({
          data: {
            label: "My Execution Job",
            jobType: "execution",
            jobId: "exec-steps",
          } as JobNodeData,
        })}
      />,
    );

    expect(screen.getByText("0 steps")).toBeTruthy();
  });

  it("renders a different job type label", () => {
    renderWithProvider(
      <JobNode
        {...createProps({
          data: {
            label: "My Command",
            jobType: "run_command",
            jobId: "cmd-1",
          } satisfies JobNodeData,
        })}
      />,
    );

    expect(screen.getByText("Run Command")).toBeTruthy();
    expect(screen.getByText("My Command")).toBeTruthy();
  });

  it("renders target and source Handles", () => {
    const { container } = renderWithProvider(<JobNode {...createProps()} />);

    const targetHandle = container.querySelector('[data-handlepos="left"]');
    const sourceHandle = container.querySelector('[data-handlepos="right"]');
    expect(targetHandle).toBeTruthy();
    expect(sourceHandle).toBeTruthy();
  });
});
