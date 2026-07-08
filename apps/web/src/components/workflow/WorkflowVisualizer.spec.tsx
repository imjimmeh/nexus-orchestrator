import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const reactFlowRenderLog: string[][] = [];

vi.mock("@xyflow/react", async () => {
  const actual =
    await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");

  return {
    ...actual,
    ReactFlow: ({
      nodes,
      edges,
      children,
    }: {
      nodes: Array<{
        id: string;
        data: {
          hasSteps?: boolean;
          isExpanded?: boolean;
          onToggleExpanded?: () => void;
          kind: string;
          label: string;
          jobId?: string;
        };
      }>;
      edges: Array<{
        id: string;
        kind: string;
        source: string;
        target: string;
      }>;
      children?: React.ReactNode;
    }) => {
      reactFlowRenderLog.push(nodes.map((node) => node.id));

      return (
        <div
          data-testid="react-flow"
          data-node-count={String(nodes.length)}
          data-edge-count={String(edges.length)}
        >
          {nodes.map((node) => (
            <div
              key={node.id}
              data-testid={`react-flow-node-${node.id}`}
              data-kind={node.data.kind}
              data-label={node.data.label}
              data-has-steps={String(Boolean(node.data.hasSteps))}
              data-expanded={String(Boolean(node.data.isExpanded))}
              data-toggle-present={String(Boolean(node.data.onToggleExpanded))}
            >
              {node.data.label}
              {node.data.onToggleExpanded ? (
                <button
                  type="button"
                  aria-label={
                    node.data.isExpanded ? "Collapse steps" : "Expand steps"
                  }
                  onClick={node.data.onToggleExpanded}
                >
                  {node.data.isExpanded ? "Collapse steps" : "Expand steps"}
                </button>
              ) : null}
            </div>
          ))}
          {edges.map((edge) => (
            <div
              key={edge.id}
              data-testid={`react-flow-edge-${edge.id}`}
              data-kind={edge.kind}
              data-source={edge.source}
              data-target={edge.target}
            />
          ))}
          {children}
        </div>
      );
    },
    Background: () => <div data-testid="react-flow-background" />,
    Controls: () => <div data-testid="react-flow-controls" />,
  };
});

import { WorkflowVisualizer } from "./WorkflowVisualizer";
import type { WorkflowRunGraph } from "../../lib/api/workflows.types";

function buildGraph(): WorkflowRunGraph {
  return {
    workflowId: "workflow-1",
    workflowRunId: "run-1",
    runStatus: "RUNNING",
    nodes: [
      {
        id: "job:build",
        label: "Build",
        kind: "job",
        status: "running",
        jobId: "build",
        metadata: { type: "execution" },
      },
      {
        id: "step-1",
        label: "Compile",
        kind: "step",
        status: "queued",
        stepId: "step-1",
        parentJobId: "build",
        metadata: { type: "agent" },
      },
      {
        id: "step-2",
        label: "Bundle",
        kind: "step",
        status: "queued",
        stepId: "step-2",
        parentJobId: "build",
        metadata: { type: "run_command" },
      },
      {
        id: "job:test",
        label: "Test",
        kind: "job",
        status: "queued",
        jobId: "test",
        metadata: { type: "execution" },
      },
      {
        id: "step-3",
        label: "Run tests",
        kind: "step",
        status: "queued",
        stepId: "step-3",
        parentJobId: "test",
        metadata: { type: "agent" },
      },
    ],
    edges: [
      {
        id: "edge-1",
        source: "job:build",
        target: "step-1",
        kind: "contains",
      },
      {
        id: "edge-2",
        source: "job:build",
        target: "step-2",
        kind: "contains",
      },
      {
        id: "edge-3",
        source: "step-1",
        target: "step-2",
        kind: "sequence",
      },
      {
        id: "edge-4",
        source: "job:test",
        target: "step-3",
        kind: "contains",
      },
      {
        id: "edge-5",
        source: "job:build",
        target: "job:test",
        kind: "depends_on",
      },
    ],
    activeNodeIds: [],
    queuedNodeIds: [],
    completedNodeIds: [],
    failedNodeIds: [],
    cursor: {
      latestEventAt: null,
      totalEvents: 0,
    },
  };
}

describe("WorkflowVisualizer", () => {
  it("normalizes prefixed job ids so raw-parent steps remain expandable", () => {
    const graph = buildGraph();
    graph.nodes[0] = {
      ...graph.nodes[0],
      jobId: "job:build",
    };

    render(<WorkflowVisualizer graph={graph} />);

    expect(
      screen
        .getByTestId("react-flow-node-job:build")
        .getAttribute("data-has-steps"),
    ).toBe("true");
    const buildNode = screen.getByTestId("react-flow-node-job:build");
    expect(
      within(buildNode).getByRole("button", { name: "Expand steps" }),
    ).toBeTruthy();

    fireEvent.click(
      within(buildNode).getByRole("button", { name: "Expand steps" }),
    );

    expect(screen.getByTestId("react-flow-node-step-1")).toBeTruthy();
  });

  it("hides step nodes by default and marks expandable jobs", () => {
    render(<WorkflowVisualizer graph={buildGraph()} />);

    expect(
      screen
        .getByTestId("react-flow-node-job:build")
        .getAttribute("data-has-steps"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("react-flow-node-job:build")
        .getAttribute("data-toggle-present"),
    ).toBe("true");
    expect(screen.queryByTestId("react-flow-node-step-1")).toBeNull();
    expect(screen.getByTestId("react-flow-node-job:test")).toBeTruthy();
    expect(
      screen.getByTestId("react-flow").getAttribute("data-edge-count"),
    ).toBe("1");
    expect(screen.queryByTestId("react-flow-edge-edge-1")).toBeNull();
    expect(screen.queryByTestId("react-flow-edge-edge-2")).toBeNull();
    expect(screen.queryByTestId("react-flow-edge-edge-3")).toBeNull();
    expect(screen.queryByTestId("react-flow-edge-edge-4")).toBeNull();
  });

  it("expands one job to reveal only its steps and internal edges", () => {
    render(<WorkflowVisualizer graph={buildGraph()} />);

    fireEvent.click(
      within(screen.getByTestId("react-flow-node-job:build")).getByRole(
        "button",
        {
          name: "Expand steps",
        },
      ),
    );

    expect(
      screen
        .getByTestId("react-flow-node-job:build")
        .getAttribute("data-expanded"),
    ).toBe("true");
    expect(screen.getByTestId("react-flow-node-step-1")).toBeTruthy();
    expect(screen.getByTestId("react-flow-node-step-2")).toBeTruthy();
    expect(screen.queryByTestId("react-flow-node-step-3")).toBeNull();
    expect(screen.getByTestId("react-flow-edge-edge-1")).toBeTruthy();
    expect(screen.getByTestId("react-flow-edge-edge-2")).toBeTruthy();
    expect(screen.getByTestId("react-flow-edge-edge-3")).toBeTruthy();
    expect(screen.queryByTestId("react-flow-edge-edge-4")).toBeNull();
  });

  it("collapses an expanded job and hides its steps again", () => {
    render(<WorkflowVisualizer graph={buildGraph()} />);

    const buildNode = screen.getByTestId("react-flow-node-job:build");
    fireEvent.click(
      within(buildNode).getByRole("button", {
        name: "Expand steps",
      }),
    );
    fireEvent.click(
      within(buildNode).getByRole("button", {
        name: "Collapse steps",
      }),
    );

    expect(
      screen
        .getByTestId("react-flow-node-job:build")
        .getAttribute("data-expanded"),
    ).toBe("false");
    expect(screen.queryByTestId("react-flow-node-step-1")).toBeNull();
    expect(screen.queryByTestId("react-flow-edge-edge-1")).toBeNull();
  });

  it("expands and collapses all expandable jobs", () => {
    render(<WorkflowVisualizer graph={buildGraph()} />);

    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));

    expect(screen.getByTestId("react-flow-node-step-1")).toBeTruthy();
    expect(screen.getByTestId("react-flow-node-step-2")).toBeTruthy();
    expect(screen.getByTestId("react-flow-node-step-3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));

    expect(screen.queryByTestId("react-flow-node-step-1")).toBeNull();
    expect(screen.queryByTestId("react-flow-node-step-2")).toBeNull();
    expect(screen.queryByTestId("react-flow-node-step-3")).toBeNull();
  });

  it("resets expanded state when the graph identity changes", () => {
    const { rerender } = render(<WorkflowVisualizer graph={buildGraph()} />);

    fireEvent.click(
      within(screen.getByTestId("react-flow-node-job:build")).getByRole(
        "button",
        {
          name: "Expand steps",
        },
      ),
    );

    rerender(
      <WorkflowVisualizer
        graph={{
          ...buildGraph(),
          workflowRunId: "run-2",
        }}
      />,
    );

    expect(
      reactFlowRenderLog[reactFlowRenderLog.length - 1] ?? [],
    ).not.toContain("step-1");
    expect(
      screen
        .getByTestId("react-flow-node-job:build")
        .getAttribute("data-expanded"),
    ).toBe("false");
    expect(screen.queryByTestId("react-flow-node-step-1")).toBeNull();
  });
});
