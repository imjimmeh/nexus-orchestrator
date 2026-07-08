import { fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import {
  WorkflowGraphNode,
  type WorkflowGraphNodeType,
} from "./WorkflowGraphNode";

function renderWithProvider(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

function createNodeProps(
  overrides: Partial<NodeProps<WorkflowGraphNodeType>> = {},
): NodeProps<WorkflowGraphNodeType> {
  return {
    id: "job-1",
    type: "workflowNode",
    data: {
      label: "Build workflow",
      kind: "job",
      status: "running",
      jobId: "job-1",
      metadata: { tier: "L2", type: "execution" },
    } as WorkflowGraphNodeType["data"],
    position: { x: 0, y: 0 },
    width: 240,
    height: 120,
    dragging: false,
    zIndex: 0,
    selected: false,
    selectable: true,
    deletable: true,
    draggable: false,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    ...overrides,
  } as unknown as NodeProps<WorkflowGraphNodeType>;
}

describe("WorkflowGraphNode", () => {
  it("renders a job node through the shared graph card", () => {
    renderWithProvider(<WorkflowGraphNode {...createNodeProps()} />);

    expect(screen.getByText("Execution")).toBeTruthy();
    expect(screen.getByText("Build workflow")).toBeTruthy();
    expect(screen.getByText("job-1")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Tier: L2")).toBeTruthy();
  });

  it("suppresses duplicate job id text when label matches", () => {
    renderWithProvider(
      <WorkflowGraphNode
        {...createNodeProps({
          data: {
            label: "job-1",
            kind: "job",
            status: "running",
            jobId: "job-1",
            metadata: { type: "execution" },
          } as unknown as WorkflowGraphNodeType["data"],
        })}
      />,
    );

    expect(screen.getAllByText("job-1")).toHaveLength(1);
  });

  it("renders compact step nodes with safe metadata labels", () => {
    const { container } = renderWithProvider(
      <WorkflowGraphNode
        {...createNodeProps({
          data: {
            label: "Run step",
            kind: "step",
            status: "queued",
            stepId: "step-7",
            parentJobId: "job-1",
            metadata: { type: "agent" },
          } as unknown as WorkflowGraphNodeType["data"],
        })}
      />,
    );

    const node = container.firstElementChild as HTMLElement;
    expect(node.className).toContain("min-w-[160px]");
    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByText("Run step")).toBeTruthy();
    expect(screen.getByText("step-7")).toBeTruthy();

    renderWithProvider(
      <WorkflowGraphNode
        {...createNodeProps({
          data: {
            label: "Fallback step",
            kind: "step",
            status: "queued",
            stepId: "step-8",
            parentJobId: "job-1",
            metadata: { type: 42 },
          } as unknown as WorkflowGraphNodeType["data"],
        })}
      />,
    );

    expect(screen.getByText("Step")).toBeTruthy();
  });

  it("renders an expand action for expandable jobs and calls the toggle handler", () => {
    const onToggleExpanded = vi.fn();

    const { rerender } = renderWithProvider(
      <WorkflowGraphNode
        {...createNodeProps({
          data: {
            label: "Expandable job",
            kind: "job",
            status: "running",
            jobId: "job-expand",
            hasSteps: true,
            isExpanded: false,
            onToggleExpanded,
            metadata: { type: "execution" },
          } as unknown as WorkflowGraphNodeType["data"],
        })}
      />,
    );

    const expandButton = screen.getByRole("button", { name: "Expand steps" });
    fireEvent.click(expandButton);
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);

    rerender(
      <ReactFlowProvider>
        <WorkflowGraphNode
          {...createNodeProps({
            data: {
              label: "Expandable job",
              kind: "job",
              status: "running",
              jobId: "job-expand",
              hasSteps: true,
              isExpanded: true,
              onToggleExpanded,
              metadata: { type: "execution" },
            } as unknown as WorkflowGraphNodeType["data"],
          })}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByRole("button", { name: "Collapse steps" })).toBeTruthy();
  });

  it("does not render an expand action for steps or non-expandable jobs", () => {
    renderWithProvider(
      <WorkflowGraphNode
        {...createNodeProps({
          data: {
            label: "Plain job",
            kind: "job",
            status: "running",
            jobId: "job-plain",
            metadata: { type: "execution" },
          } as unknown as WorkflowGraphNodeType["data"],
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Expand steps" })).toBeNull();

    renderWithProvider(
      <WorkflowGraphNode
        {...createNodeProps({
          data: {
            label: "Plain step",
            kind: "step",
            status: "queued",
            stepId: "step-plain",
            parentJobId: "job-plain",
            metadata: { type: "agent" },
          } as unknown as WorkflowGraphNodeType["data"],
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Expand steps" })).toBeNull();
  });

  it("does not render an expand action when hasSteps is true without a toggle handler", () => {
    renderWithProvider(
      <WorkflowGraphNode
        {...createNodeProps({
          data: {
            label: "Pending job",
            kind: "job",
            status: "running",
            jobId: "job-pending",
            hasSteps: true,
            metadata: { type: "execution" },
          } as unknown as WorkflowGraphNodeType["data"],
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Expand steps" })).toBeNull();
  });
});
