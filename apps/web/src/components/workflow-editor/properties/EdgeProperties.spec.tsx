import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";
import { EdgeProperties } from "./EdgeProperties";
import { useWorkflowEditorStore } from "../hooks/useWorkflowEditorStore";
import type {
  DependencyEdgeData,
  TransitionEdgeData,
  SwitchEdgeData,
  WorkflowEdge,
} from "../serialization/types";

function createDependencyEdge(
  data: Partial<DependencyEdgeData> = {},
  id = "edge-1",
): WorkflowEdge {
  return {
    id,
    source: "node-1",
    target: "node-2",
    data: { kind: "dependency", ...data },
  };
}

function createTransitionEdge(
  data: Partial<TransitionEdgeData> = {},
  id = "edge-1",
): WorkflowEdge {
  return {
    id,
    source: "node-1",
    target: "node-2",
    data: { kind: "transition", condition: "", target: "node-2", ...data },
  };
}

function createSwitchEdge(
  data: Partial<SwitchEdgeData> = {},
  id = "edge-1",
): WorkflowEdge {
  return {
    id,
    source: "node-1",
    target: "node-2",
    data: { kind: "switch", caseCondition: "", ...data },
  };
}

function renderProperties() {
  return render(<EdgeProperties />);
}

const RESULT_POLICY_OPTIONS = [
  { value: "success", label: "Success" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "success_or_skipped", label: "Success or Skipped" },
  { value: "any", label: "Any" },
];

describe("EdgeProperties", () => {
  beforeEach(() => {
    useWorkflowEditorStore.getState().resetState({});
  });

  describe("no edge selected", () => {
    it("returns null when no element is selected", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: null,
        edges: [createDependencyEdge()],
      });

      const { container } = renderProperties();

      expect(container.firstChild).toBeNull();
    });

    it("returns null when selected element is not an edge", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "node-1",
        edges: [createDependencyEdge()],
      });

      const { container } = renderProperties();

      expect(container.firstChild).toBeNull();
    });
  });

  describe("edge kind and connectivity", () => {
    it("renders edge kind as read-only", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [createDependencyEdge({ kind: "dependency" })],
      });

      renderProperties();

      expect(screen.getByText("Kind")).toBeTruthy();
      expect(screen.getByText("dependency")).toBeTruthy();
    });

    it("renders source and target as read-only", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [createDependencyEdge({}, "edge-1")],
      });

      renderProperties();

      expect(screen.getByText("Source")).toBeTruthy();
      expect(screen.getByText("Target")).toBeTruthy();
      expect(screen.getByText("node-1")).toBeTruthy();
      expect(screen.getByText("node-2")).toBeTruthy();
    });
  });

  describe("dependency edge fields", () => {
    it("renders result policy selector for dependency edges", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [createDependencyEdge({ resultPolicy: "success" })],
      });

      renderProperties();

      const select = screen.getByRole("combobox", { name: "Result Policy" });
      expect(select).toBeTruthy();
      expect(select.textContent).toContain("Success");
    });

    it("renders optional toggle for dependency edges", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [createDependencyEdge({ optional: false })],
      });

      renderProperties();

      expect(screen.getByRole("checkbox", { name: "Optional" })).toBeTruthy();
    });

    it("writes result policy to store on change", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [createDependencyEdge({ resultPolicy: "success" })],
      });

      renderProperties();

      const select = screen.getByRole("combobox", { name: "Result Policy" });
      await user.click(select);
      await user.click(screen.getByRole("option", { name: "Any" }));

      const edges = useWorkflowEditorStore.getState().edges as WorkflowEdge[];
      const data = edges[0].data as DependencyEdgeData;
      expect(data.resultPolicy).toBe("any");
    });

    it("writes optional to store on toggle", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [createDependencyEdge({ optional: false })],
      });

      renderProperties();

      await user.click(screen.getByRole("checkbox", { name: "Optional" }));

      const edges = useWorkflowEditorStore.getState().edges as WorkflowEdge[];
      const data = edges[0].data as DependencyEdgeData;
      expect(data.optional).toBe(true);
    });

    it("defaults resultPolicy to success when not set", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [createDependencyEdge({})],
      });

      renderProperties();

      expect(screen.getByText("Success")).toBeTruthy();
    });
  });

  describe("transition edge fields", () => {
    it("renders condition field for transition edges", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [
          createTransitionEdge({ condition: "{{eq step.status 'done'}}" }),
        ],
      });

      renderProperties();

      const input = screen.getByRole("textbox", { name: "Condition" });
      expect(input).toBeTruthy();
      expect((input as HTMLInputElement).value).toBe(
        "{{eq step.status 'done'}}",
      );
    });

    it("renders target as read-only for transition edges", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [createTransitionEdge({ target: "step-done" })],
      });

      renderProperties();

      expect(screen.getByText("step-done")).toBeTruthy();
    });

    it("writes condition to store on change", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [createTransitionEdge({ condition: "" })],
      });

      renderProperties();

      const input = screen.getByRole("textbox", { name: "Condition" });
      await user.type(input, "{{{{eq status 'done'}}");

      const edges = useWorkflowEditorStore.getState().edges as WorkflowEdge[];
      const data = edges[0].data as TransitionEdgeData;
      expect(data.condition).toBe("{{eq status 'done'}}");
    });
  });

  describe("switch edge fields", () => {
    it("renders case condition field for switch edges", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [
          createSwitchEdge({
            caseCondition: "{{eq value 'a'}}",
          }),
        ],
      });

      renderProperties();

      const input = screen.getByRole("textbox", { name: "Case Condition" });
      expect(input).toBeTruthy();
      expect((input as HTMLInputElement).value).toBe("{{eq value 'a'}}");
    });

    it("renders isDefault toggle for switch edges", () => {
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [createSwitchEdge({ isDefault: true })],
      });

      renderProperties();

      const checkbox = screen.getByRole("checkbox", { name: "Default" });
      expect(checkbox.getAttribute("data-state")).toBe("checked");
    });

    it("writes caseCondition to store on change", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [createSwitchEdge({ caseCondition: "" })],
      });

      renderProperties();

      const input = screen.getByRole("textbox", { name: "Case Condition" });
      await user.type(input, "new");

      const edges = useWorkflowEditorStore.getState().edges as WorkflowEdge[];
      const data = edges[0].data as SwitchEdgeData;
      expect(data.caseCondition).toBe("new");
    });

    it("writes isDefault to store on toggle", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [createSwitchEdge({ isDefault: false })],
      });

      renderProperties();

      await user.click(screen.getByRole("checkbox", { name: "Default" }));

      const edges = useWorkflowEditorStore.getState().edges as WorkflowEdge[];
      const data = edges[0].data as SwitchEdgeData;
      expect(data.isDefault).toBe(true);
    });
  });

  describe("pushAction for undo", () => {
    it("pushes an update_edge_data action when data changes", async () => {
      const user = userEvent.setup();
      useWorkflowEditorStore.setState({
        selectedElementId: "edge-1",
        edges: [createDependencyEdge({ resultPolicy: "success" })],
      });

      renderProperties();

      const select = screen.getByRole("combobox", { name: "Result Policy" });
      await user.click(select);
      await user.click(screen.getByRole("option", { name: "Any" }));

      const undoStack = useWorkflowEditorStore.getState().undoStack;
      expect(undoStack.length).toBeGreaterThanOrEqual(1);
      const lastAction = undoStack[undoStack.length - 1];
      expect(lastAction.type).toBe("update_edge_data");
    });
  });
});
