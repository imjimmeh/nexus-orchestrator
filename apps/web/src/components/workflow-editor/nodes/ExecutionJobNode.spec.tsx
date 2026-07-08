import { act, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExecutionJobNode } from "./ExecutionJobNode";
import { useWorkflowEditorStore } from "../hooks/useWorkflowEditorStore";
import type {
  JobNodeData,
  JobNode as JobNodeType,
  StepNodeData,
  StepNode as StepNodeType,
} from "../serialization/types";

function renderWithProvider(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

type WorkflowEditorStateUpdate = Partial<
  ReturnType<typeof useWorkflowEditorStore.getState>
>;

function setWorkflowEditorState(update: WorkflowEditorStateUpdate) {
  act(() => {
    useWorkflowEditorStore.setState(update);
  });
}

function resetWorkflowEditorState() {
  act(() => {
    useWorkflowEditorStore.getState().resetState({});
  });
}

function createProps(overrides: Partial<JobNodeType> = {}) {
  return {
    id: "exec-1",
    type: "job" as const,
    position: { x: 0, y: 0 },
    data: {
      label: "Execution Job",
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

describe("ExecutionJobNode", () => {
  afterEach(() => {
    resetWorkflowEditorState();
  });

  it("renders the execution job label", () => {
    renderWithProvider(<ExecutionJobNode {...createProps()} />);

    expect(screen.getByText("Execution Job")).toBeTruthy();
  });

  it("renders an expand toggle", () => {
    renderWithProvider(<ExecutionJobNode {...createProps()} />);

    const toggle = screen.getByRole("button");
    expect(toggle).toBeTruthy();
  });

  it("starts collapsed by default", () => {
    renderWithProvider(<ExecutionJobNode {...createProps()} />);

    const toggle = screen.getByRole("button");
    expect(toggle.textContent).toContain("Expand");
  });

  it("expands when toggle is clicked", () => {
    renderWithProvider(<ExecutionJobNode {...createProps()} />);

    const toggle = screen.getByRole("button");
    act(() => {
      toggle.click();
    });

    expect(toggle.textContent).toContain("Collapse");
  });

  describe("inline step expansion", () => {
    const jobId = "exec-1";

    function setupStepStore() {
      const stepNode1: StepNodeType = {
        id: `${jobId}.step-1`,
        type: "step",
        parentId: jobId,
        position: { x: 100, y: 150 },
        data: {
          label: "Step One",
          stepType: "agent" as const,
          stepId: "step-1",
          parentJobId: jobId,
          prompt: "Write code",
        } satisfies StepNodeData,
      };

      const stepNode2: StepNodeType = {
        id: `${jobId}.step-2`,
        type: "step",
        parentId: jobId,
        position: { x: 100, y: 270 },
        data: {
          label: "Step Two",
          stepType: "run_command" as const,
          stepId: "step-2",
          parentJobId: jobId,
          command: "npm run build",
        } satisfies StepNodeData,
      };

      setWorkflowEditorState({
        nodes: [stepNode1, stepNode2],
        edges: [],
      });

      return { stepNode1, stepNode2 };
    }

    it("renders child step nodes inline when expanded", () => {
      setupStepStore();
      renderWithProvider(<ExecutionJobNode {...createProps()} />);

      const toggle = screen.getByRole("button");
      act(() => {
        toggle.click();
      });

      expect(screen.getByText("Step One")).toBeTruthy();
      expect(screen.getByText("Step Two")).toBeTruthy();
    });

    it("hides child step nodes in the canvas when collapsed", () => {
      setupStepStore();
      renderWithProvider(<ExecutionJobNode {...createProps()} />);

      const { nodes } = useWorkflowEditorStore.getState();
      const stepNodes = nodes.filter((n) => n.parentId === jobId);
      expect(stepNodes.length).toBeGreaterThan(0);
      for (const sn of stepNodes) {
        expect(sn.hidden).toBe(true);
      }
    });

    it("shows child step nodes in the canvas when expanded", () => {
      setupStepStore();
      renderWithProvider(<ExecutionJobNode {...createProps()} />);

      const toggle = screen.getByRole("button");
      act(() => {
        toggle.click();
      });

      const { nodes } = useWorkflowEditorStore.getState();
      const stepNodes = nodes.filter((n) => n.parentId === jobId);
      expect(stepNodes.length).toBeGreaterThan(0);
      for (const sn of stepNodes) {
        expect(sn.hidden).toBe(false);
      }
    });

    it("does not affect step nodes belonging to other jobs", () => {
      const otherStep: StepNodeType = {
        id: "other-job.step-1",
        type: "step",
        parentId: "other-job",
        position: { x: 0, y: 0 },
        data: {
          label: "Other Step",
          stepType: "agent" as const,
          stepId: "step-other",
          parentJobId: "other-job",
        } satisfies StepNodeData,
        hidden: true,
      };

      setWorkflowEditorState({
        nodes: [otherStep],
        edges: [],
      });

      renderWithProvider(<ExecutionJobNode {...createProps()} />);

      const { nodes } = useWorkflowEditorStore.getState();
      const otherStepNode = nodes.find((n) => n.id === "other-job.step-1");
      expect(otherStepNode?.hidden).toBe(true);
    });
  });
});
