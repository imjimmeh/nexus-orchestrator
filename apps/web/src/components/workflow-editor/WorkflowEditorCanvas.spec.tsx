import { render, screen, fireEvent, act } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  WorkflowEditorCanvas,
  createConnectionHandler,
  createSelectionChangeHandler,
} from "./WorkflowEditorCanvas";
import { useWorkflowEditorStore } from "./hooks/useWorkflowEditorStore";
import { JobNode } from "./nodes/JobNode";
import { DependencyEdge } from "./edges/DependencyEdge";
import type { Node, Edge, Connection } from "@xyflow/react";
import type { JobNodeData, DependencyEdgeData } from "./serialization/types";

const nodeTypes = { job: JobNode };
const edgeTypes = { dependency: DependencyEdge };

function makeJobNode(
  id: string,
  overrides: Partial<Node<JobNodeData>> = {},
): Node<JobNodeData> {
  return {
    id,
    type: "job",
    position: { x: 100, y: 100 },
    data: { label: `Job ${id}`, jobType: "execution", jobId: id },
    ...overrides,
  } as Node<JobNodeData>;
}

function makeDependencyEdge(
  id: string,
  source: string,
  target: string,
): Edge<DependencyEdgeData> {
  return {
    id,
    source,
    target,
    type: "dependency",
    data: { kind: "dependency" },
  };
}

function mockGetBoundingClientRect(element: HTMLElement) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: vi.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    })),
  });
}

function renderCanvas() {
  const result = render(
    <ReactFlowProvider>
      <WorkflowEditorCanvas nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
    </ReactFlowProvider>,
  );
  const flowContainer = result.container.querySelector(".react-flow");
  if (flowContainer) {
    mockGetBoundingClientRect(flowContainer as HTMLElement);
  }
  return result;
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

describe("WorkflowEditorCanvas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetWorkflowEditorState();
  });

  describe("rendering", () => {
    it("renders ReactFlow with nodes", () => {
      const nodeA = makeJobNode("node-a");
      const nodeB = makeJobNode("node-b", { position: { x: 300, y: 100 } });
      setWorkflowEditorState({ nodes: [nodeA, nodeB] });

      renderCanvas();

      const nodeElements = document.querySelectorAll(".react-flow__node");
      expect(nodeElements.length).toBe(2);
    });

    it("renders ReactFlow with edges", () => {
      const nodeA = makeJobNode("node-a");
      const nodeB = makeJobNode("node-b", { position: { x: 300, y: 100 } });
      const edge = makeDependencyEdge("edge-1", "node-a", "node-b");
      setWorkflowEditorState({ nodes: [nodeA, nodeB], edges: [edge] });

      const { container } = renderCanvas();

      const svgElements = container.querySelectorAll("svg");
      expect(svgElements.length).toBeGreaterThan(0);

      let pathCount = 0;
      for (const svg of svgElements) {
        pathCount += svg.querySelectorAll("path").length;
      }
      expect(pathCount).toBeGreaterThanOrEqual(1);
    });

    it("renders Background component", () => {
      renderCanvas();

      const background = document.querySelector(".react-flow__background");
      expect(background).toBeTruthy();
    });

    it("renders MiniMap component", () => {
      renderCanvas();

      const minimap = document.querySelector(".react-flow__minimap");
      expect(minimap).toBeTruthy();
    });

    it("renders Controls component", () => {
      renderCanvas();

      const controls = document.querySelector(".react-flow__controls");
      expect(controls).toBeTruthy();
    });
  });

  describe("node selection", () => {
    it("sets selectedElementId when a node is clicked", () => {
      const nodeA = makeJobNode("node-a");
      setWorkflowEditorState({ nodes: [nodeA] });
      renderCanvas();

      const nodeElement = document.querySelector(
        ".react-flow__node",
      ) as HTMLElement;
      expect(nodeElement).toBeTruthy();

      fireEvent.click(nodeElement);

      expect(useWorkflowEditorStore.getState().selectedElementId).toBe(
        "node-a",
      );
    });

    it("clears selectedElementId when selection becomes empty", () => {
      const nodeA = makeJobNode("node-a");
      const selectionState = { current: false };
      const handler = createSelectionChangeHandler(
        useWorkflowEditorStore.getState().setSelectedElementId,
        selectionState,
      );

      handler({ nodes: [nodeA], edges: [] });
      expect(useWorkflowEditorStore.getState().selectedElementId).toBe(
        "node-a",
      );

      handler({ nodes: [], edges: [] });
      expect(useWorkflowEditorStore.getState().selectedElementId).toBeNull();
    });
  });

  describe("pane click", () => {
    it("clears selectedElementId when pane is clicked", () => {
      setWorkflowEditorState({ selectedElementId: "node-a" });
      const nodeA = makeJobNode("node-a");
      setWorkflowEditorState({ nodes: [nodeA] });
      renderCanvas();

      const pane = document.querySelector(".react-flow__pane") as HTMLElement;
      expect(pane).toBeTruthy();

      fireEvent.click(pane);

      expect(useWorkflowEditorStore.getState().selectedElementId).toBeNull();
    });
  });

  describe("drag and drop", () => {
    it("prevents default on dragOver", () => {
      renderCanvas();

      const container = document.querySelector(".react-flow") as HTMLElement;
      const dragOverEvent = new Event("dragover", {
        bubbles: true,
        cancelable: true,
      });
      fireEvent(container, dragOverEvent);

      expect(dragOverEvent.defaultPrevented).toBe(true);
    });

    it("creates a new job node on drop with execution job type", () => {
      const nodeA = makeJobNode("node-a");
      setWorkflowEditorState({ nodes: [nodeA] });
      renderCanvas();

      const container = document.querySelector(".react-flow") as HTMLElement;
      const dropEvent = new Event("drop", {
        bubbles: true,
        cancelable: true,
      }) as DragEvent;
      Object.defineProperty(dropEvent, "dataTransfer", {
        get: () => ({
          getData: vi.fn((format: string) => {
            if (format === "application/reactflow") return "execution";
            return "";
          }),
          dropEffect: "none",
          setData: vi.fn(),
        }),
      });
      Object.defineProperty(dropEvent, "clientX", { value: 200 });
      Object.defineProperty(dropEvent, "clientY", { value: 150 });

      fireEvent(container, dropEvent);

      const state = useWorkflowEditorStore.getState();
      expect(state.nodes.length).toBe(2);
      const newNode = state.nodes[1];
      expect(newNode.type).toBe("job");
      expect(newNode.data.jobType).toBe("execution");
    });
  });

  describe("connection handling", () => {
    it("creates a dependency edge when onConnect is called", () => {
      const store = useWorkflowEditorStore.getState();

      const handler = createConnectionHandler(
        [],
        store.setEdges,
        store.pushAction,
      );

      handler({
        source: "node-a",
        target: "node-b",
        sourceHandle: null,
        targetHandle: null,
      } as Connection);

      const state = useWorkflowEditorStore.getState();
      expect(state.edges.length).toBe(1);
      expect(state.edges[0].source).toBe("node-a");
      expect(state.edges[0].target).toBe("node-b");
      expect(state.edges[0].type).toBe("dependency");
    });

    it("avoids duplicate edges when connection already exists", () => {
      const existingEdge = makeDependencyEdge(
        "edge-existing",
        "node-a",
        "node-b",
      );

      const handler = createConnectionHandler(
        [existingEdge],
        useWorkflowEditorStore.getState().setEdges,
        useWorkflowEditorStore.getState().pushAction,
      );

      const edgesBefore = useWorkflowEditorStore.getState().edges.length;

      handler({
        source: "node-a",
        target: "node-b",
        sourceHandle: null,
        targetHandle: null,
      } as Connection);

      const state = useWorkflowEditorStore.getState();
      expect(state.edges.length).toBe(edgesBefore);
    });

    it("does nothing when source or target is missing", () => {
      const edgesBefore = useWorkflowEditorStore.getState().edges.length;

      const handler = createConnectionHandler(
        [],
        useWorkflowEditorStore.getState().setEdges,
        useWorkflowEditorStore.getState().pushAction,
      );

      handler({
        source: null,
        target: "node-b",
        sourceHandle: null,
        targetHandle: null,
      } as unknown as Connection);

      handler({
        source: "node-a",
        target: null,
        sourceHandle: null,
        targetHandle: null,
      } as unknown as Connection);

      const state = useWorkflowEditorStore.getState();
      expect(state.edges.length).toBe(edgesBefore);
    });
  });

  describe("delete key handling", () => {
    function seedSelectedNode(nodeId = "node-a") {
      const node = makeJobNode(nodeId);
      setWorkflowEditorState({
        nodes: [node],
        selectedElementId: nodeId,
      });
      return node;
    }

    it("syncs selected edge ids from React Flow selection and deletes them", () => {
      const nodeA = makeJobNode("node-a");
      const nodeB = makeJobNode("node-b", { position: { x: 300, y: 100 } });
      const edge = makeDependencyEdge("edge-1", "node-a", "node-b");
      setWorkflowEditorState({
        nodes: [nodeA, nodeB],
        edges: [edge],
      });

      renderCanvas();

      const selectSelection = createSelectionChangeHandler(
        useWorkflowEditorStore.getState().setSelectedElementId,
      );
      act(() => {
        selectSelection({ nodes: [], edges: [edge] });
      });

      expect(useWorkflowEditorStore.getState().selectedElementId).toBe(
        "edge-1",
      );

      fireEvent.keyDown(window, { key: "Delete" });

      const state = useWorkflowEditorStore.getState();
      expect(state.edges).toHaveLength(0);
      expect(state.selectedElementId).toBeNull();
      expect(state.undoStack).toHaveLength(1);
    });

    it("removes selected node and connected edges on Delete key", () => {
      const nodeA = makeJobNode("node-a");
      const nodeB = makeJobNode("node-b", { position: { x: 300, y: 100 } });
      const edge = makeDependencyEdge("edge-1", "node-a", "node-b");
      setWorkflowEditorState({
        nodes: [nodeA, nodeB],
        edges: [edge],
        selectedElementId: "node-a",
      });

      renderCanvas();

      fireEvent.keyDown(window, { key: "Delete" });

      const state = useWorkflowEditorStore.getState();
      expect(state.nodes.length).toBe(1);
      expect(state.nodes[0].id).toBe("node-b");
      expect(state.edges.length).toBe(0);
      expect(state.selectedElementId).toBeNull();
      expect(state.undoStack).toHaveLength(1);
    });

    it("removes selected node on Backspace key", () => {
      const nodeA = makeJobNode("node-a");
      setWorkflowEditorState({
        nodes: [nodeA],
        selectedElementId: "node-a",
      });

      renderCanvas();

      fireEvent.keyDown(window, { key: "Backspace" });

      const state = useWorkflowEditorStore.getState();
      expect(state.nodes.length).toBe(0);
      expect(state.selectedElementId).toBeNull();
      expect(state.undoStack).toHaveLength(1);
    });

    it("removes selected edge on Delete key", () => {
      const nodeA = makeJobNode("node-a");
      const nodeB = makeJobNode("node-b", { position: { x: 300, y: 100 } });
      const edge = makeDependencyEdge("edge-1", "node-a", "node-b");
      setWorkflowEditorState({
        nodes: [nodeA, nodeB],
        edges: [edge],
        selectedElementId: "edge-1",
      });

      renderCanvas();

      fireEvent.keyDown(window, { key: "Delete" });

      const state = useWorkflowEditorStore.getState();
      expect(state.edges.length).toBe(0);
      expect(state.nodes.length).toBe(2);
      expect(state.selectedElementId).toBeNull();
      expect(state.undoStack).toHaveLength(1);
    });

    it("does nothing when no element is selected", () => {
      const nodeA = makeJobNode("node-a");
      setWorkflowEditorState({
        nodes: [nodeA],
        selectedElementId: null,
      });

      renderCanvas();

      fireEvent.keyDown(window, { key: "Delete" });

      const state = useWorkflowEditorStore.getState();
      expect(state.nodes.length).toBe(1);
    });

    it("ignores Delete key when an input element is focused", () => {
      const nodeA = seedSelectedNode();
      render(
        <ReactFlowProvider>
          <input data-testid="test-input" />
          <WorkflowEditorCanvas nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
        </ReactFlowProvider>,
      );

      fireEvent.keyDown(window, { key: "Delete" });
      expect(useWorkflowEditorStore.getState().nodes).toHaveLength(0);

      setWorkflowEditorState({
        nodes: [nodeA],
        selectedElementId: "node-a",
      });

      const input = screen.getByTestId("test-input");
      (input as HTMLInputElement).focus();
      fireEvent.keyDown(input, { key: "Delete" });

      const state = useWorkflowEditorStore.getState();
      expect(state.nodes.length).toBe(1);
    });

    it("ignores Delete key when a textarea element is focused", () => {
      const nodeA = seedSelectedNode();
      render(
        <ReactFlowProvider>
          <textarea data-testid="test-textarea" />
          <WorkflowEditorCanvas nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
        </ReactFlowProvider>,
      );

      fireEvent.keyDown(window, { key: "Delete" });
      expect(useWorkflowEditorStore.getState().nodes).toHaveLength(0);

      setWorkflowEditorState({
        nodes: [nodeA],
        selectedElementId: "node-a",
      });

      const textarea = screen.getByTestId("test-textarea");
      (textarea as HTMLTextAreaElement).focus();
      fireEvent.keyDown(textarea, { key: "Delete" });

      const state = useWorkflowEditorStore.getState();
      expect(state.nodes.length).toBe(1);
    });

    it("ignores Delete key when a select element is focused", () => {
      const nodeA = seedSelectedNode();
      render(
        <ReactFlowProvider>
          <select data-testid="test-select">
            <option value="one">One</option>
          </select>
          <WorkflowEditorCanvas nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
        </ReactFlowProvider>,
      );

      fireEvent.keyDown(window, { key: "Delete" });
      expect(useWorkflowEditorStore.getState().nodes).toHaveLength(0);

      setWorkflowEditorState({
        nodes: [nodeA],
        selectedElementId: "node-a",
      });

      const select = screen.getByTestId("test-select");
      (select as HTMLSelectElement).focus();
      fireEvent.keyDown(select, { key: "Delete" });

      const state = useWorkflowEditorStore.getState();
      expect(state.nodes.length).toBe(1);
    });

    it("ignores Delete key when default was already prevented", () => {
      const nodeA = seedSelectedNode();

      renderCanvas();

      fireEvent.keyDown(window, { key: "Delete" });
      expect(useWorkflowEditorStore.getState().nodes).toHaveLength(0);

      setWorkflowEditorState({
        nodes: [nodeA],
        selectedElementId: "node-a",
      });

      const event = new KeyboardEvent("keydown", {
        key: "Delete",
        bubbles: true,
        cancelable: true,
      });
      window.addEventListener(
        "keydown",
        (keyboardEvent) => keyboardEvent.preventDefault(),
        { once: true, capture: true },
      );

      act(() => {
        window.dispatchEvent(event);
      });

      const state = useWorkflowEditorStore.getState();
      expect(state.nodes.length).toBe(1);
    });

    it("ignores Delete key when editing contentEditable text", () => {
      const nodeA = seedSelectedNode();
      render(
        <ReactFlowProvider>
          <div data-testid="editable" contentEditable tabIndex={0} />
          <WorkflowEditorCanvas nodeTypes={nodeTypes} edgeTypes={edgeTypes} />
        </ReactFlowProvider>,
      );

      fireEvent.keyDown(window, { key: "Delete" });
      expect(useWorkflowEditorStore.getState().nodes).toHaveLength(0);

      setWorkflowEditorState({
        nodes: [nodeA],
        selectedElementId: "node-a",
      });

      const editable = screen.getByTestId("editable");
      Object.defineProperty(editable, "isContentEditable", {
        configurable: true,
        value: true,
      });
      (editable as HTMLElement).focus();
      fireEvent.keyDown(editable, { key: "Delete" });

      const state = useWorkflowEditorStore.getState();
      expect(state.nodes.length).toBe(1);
    });
  });

  describe("delete action", () => {
    it("removes selected node and connected edges through the store action", () => {
      const nodeA = makeJobNode("node-a");
      const nodeB = makeJobNode("node-b", { position: { x: 300, y: 100 } });
      const edge = makeDependencyEdge("edge-1", "node-a", "node-b");
      setWorkflowEditorState({
        nodes: [nodeA, nodeB],
        edges: [edge],
        selectedElementId: "node-a",
      });

      useWorkflowEditorStore.getState().deleteSelectedElement();

      const state = useWorkflowEditorStore.getState();
      expect(state.nodes).toHaveLength(1);
      expect(state.nodes[0].id).toBe("node-b");
      expect(state.edges).toHaveLength(0);
      expect(state.selectedElementId).toBeNull();
      expect(state.undoStack).toHaveLength(1);
    });

    it("removes selected edge through the store action", () => {
      const nodeA = makeJobNode("node-a");
      const nodeB = makeJobNode("node-b", { position: { x: 300, y: 100 } });
      const edge = makeDependencyEdge("edge-1", "node-a", "node-b");
      setWorkflowEditorState({
        nodes: [nodeA, nodeB],
        edges: [edge],
        selectedElementId: "edge-1",
      });

      useWorkflowEditorStore.getState().deleteSelectedElement();

      const state = useWorkflowEditorStore.getState();
      expect(state.nodes).toHaveLength(2);
      expect(state.edges).toHaveLength(0);
      expect(state.selectedElementId).toBeNull();
      expect(state.undoStack).toHaveLength(1);
    });
  });
});
