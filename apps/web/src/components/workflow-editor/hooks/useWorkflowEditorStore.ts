import { create } from "zustand";
import type { Node, Edge } from "@xyflow/react";
import type {
  EditorAction,
  WorkflowEditorData,
  WorkflowEditorState,
} from "./useWorkflowEditorStore.types";

const initialState: WorkflowEditorData = {
  workflowId: "",
  name: "",
  description: "",
  active: true,
  trigger: null,
  concurrency: null,
  globalEnv: {},
  permissions: null,
  strictDependencies: false,
  nodes: [],
  edges: [],
  selectedElementId: null,
  isDirty: false,
  undoStack: [],
  redoStack: [],
  validationErrors: {},
};

interface NodeActionPayload {
  node: Node;
  nodeIndex: number;
  connectedEdges: Edge[];
  edgeIndexes: number[];
}

interface EdgeActionPayload {
  edge: Edge;
  edgeIndex: number;
}

function insertAtIndex<T>(items: T[], item: T, index: number): T[] {
  const clampedIndex = Math.max(0, Math.min(index, items.length));
  return [...items.slice(0, clampedIndex), item, ...items.slice(clampedIndex)];
}

function insertEdgesAtIndexes(
  items: Edge[],
  edgesToInsert: Edge[],
  indexes: number[],
): Edge[] {
  const orderedInsertions = edgesToInsert
    .map((edge, index) => ({ edge, index: indexes[index] ?? items.length }))
    .sort((left, right) => left.index - right.index);

  return orderedInsertions.reduce(
    (currentItems, { edge, index }) => insertAtIndex(currentItems, edge, index),
    items,
  );
}

function createRemoveNodeAction(
  node: Node,
  nodeIndex: number,
  connectedEdges: Edge[] = [],
  edgeIndexes: number[] = [],
): EditorAction {
  return {
    type: "remove_node",
    payload: {
      node,
      nodeIndex,
      connectedEdges,
      edgeIndexes,
    } satisfies NodeActionPayload,
    inverse: () =>
      createAddNodeAction(node, nodeIndex, connectedEdges, edgeIndexes),
  };
}

export function createAddNodeAction(
  node: Node,
  nodeIndex = Number.MAX_SAFE_INTEGER,
  connectedEdges: Edge[] = [],
  edgeIndexes: number[] = [],
): EditorAction {
  return {
    type: "add_node",
    payload: {
      node,
      nodeIndex,
      connectedEdges,
      edgeIndexes,
    } satisfies NodeActionPayload,
    inverse: () =>
      createRemoveNodeAction(node, nodeIndex, connectedEdges, edgeIndexes),
  };
}

function createRemoveEdgeAction(edge: Edge, edgeIndex: number): EditorAction {
  return {
    type: "remove_edge",
    payload: {
      edge,
      edgeIndex,
    } satisfies EdgeActionPayload,
    inverse: () => createAddEdgeAction(edge, edgeIndex),
  };
}

export function createAddEdgeAction(
  edge: Edge,
  edgeIndex = Number.MAX_SAFE_INTEGER,
): EditorAction {
  return {
    type: "add_edge",
    payload: {
      edge,
      edgeIndex,
    } satisfies EdgeActionPayload,
    inverse: () => createRemoveEdgeAction(edge, edgeIndex),
  };
}

function applyWorkflowEditorAction(
  state: WorkflowEditorData,
  action: EditorAction,
): Partial<WorkflowEditorData> {
  if (action.type === "add_node") {
    const payload = action.payload as NodeActionPayload | null;
    if (!payload) return {};

    return {
      nodes: insertAtIndex(state.nodes, payload.node, payload.nodeIndex),
      edges: insertEdgesAtIndexes(
        state.edges,
        payload.connectedEdges,
        payload.edgeIndexes,
      ),
    };
  }

  if (action.type === "remove_node") {
    const payload = action.payload as NodeActionPayload | null;
    if (!payload) return {};

    return {
      nodes: state.nodes.filter((node) => node.id !== payload.node.id),
      edges: state.edges.filter(
        (edge) =>
          !payload.connectedEdges.some(
            (connectedEdge) => connectedEdge.id === edge.id,
          ),
      ),
      selectedElementId:
        state.selectedElementId === payload.node.id
          ? null
          : state.selectedElementId,
    };
  }

  if (action.type === "add_edge") {
    const payload = action.payload as EdgeActionPayload | null;
    if (!payload) return {};

    return {
      edges: insertAtIndex(state.edges, payload.edge, payload.edgeIndex),
    };
  }

  if (action.type === "remove_edge") {
    const payload = action.payload as EdgeActionPayload | null;
    if (!payload) return {};

    return {
      edges: state.edges.filter((edge) => edge.id !== payload.edge.id),
      selectedElementId:
        state.selectedElementId === payload.edge.id
          ? null
          : state.selectedElementId,
    };
  }

  return {};
}

export const useWorkflowEditorStore = create<WorkflowEditorState>()(
  (set, get) => ({
    ...initialState,

    setMetadata(partial) {
      set({ ...partial, isDirty: true });
    },

    setNodes(nodes) {
      set({ nodes, isDirty: true });
    },

    setEdges(edges) {
      set({ edges, isDirty: true });
    },

    setSelectedElementId(selectedElementId) {
      set({ selectedElementId });
    },

    deleteSelectedElement() {
      const { selectedElementId, nodes, edges } = get();
      if (!selectedElementId) return;

      const nodeIndex = nodes.findIndex(
        (node) => node.id === selectedElementId,
      );
      const nodeToRemove = nodeIndex >= 0 ? nodes[nodeIndex] : undefined;
      if (nodeToRemove) {
        const connectedEdges = edges.filter(
          (edge) =>
            edge.source === selectedElementId ||
            edge.target === selectedElementId,
        );
        const edgeIndexes = connectedEdges.map((edge) =>
          edges.findIndex((candidate) => candidate.id === edge.id),
        );

        set({
          nodes: nodes.filter((node) => node.id !== selectedElementId),
          edges: edges.filter(
            (edge) =>
              edge.source !== selectedElementId &&
              edge.target !== selectedElementId,
          ),
          selectedElementId: null,
        });
        get().pushAction(
          createRemoveNodeAction(
            nodeToRemove,
            nodeIndex,
            connectedEdges,
            edgeIndexes,
          ),
        );
        return;
      }

      const edgeIndex = edges.findIndex(
        (edge) => edge.id === selectedElementId,
      );
      const edgeToRemove = edgeIndex >= 0 ? edges[edgeIndex] : undefined;
      if (!edgeToRemove) return;

      set({
        edges: edges.filter((edge) => edge.id !== selectedElementId),
        selectedElementId: null,
      });
      get().pushAction(createRemoveEdgeAction(edgeToRemove, edgeIndex));
    },

    pushAction(action) {
      set((state) => ({
        undoStack: [...state.undoStack, action],
        redoStack: [],
        isDirty: true,
      }));
    },

    undo() {
      const { undoStack } = get();
      if (undoStack.length === 0) return;
      const last = undoStack[undoStack.length - 1];
      const redoAction = last.inverse();
      set((state) => ({
        ...applyWorkflowEditorAction(state, redoAction),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, redoAction],
        isDirty: true,
      }));
    },

    redo() {
      const { redoStack } = get();
      if (redoStack.length === 0) return;
      const last = redoStack[redoStack.length - 1];
      const undoAction = last.inverse();
      set((state) => ({
        ...applyWorkflowEditorAction(state, undoAction),
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, undoAction],
        isDirty: true,
      }));
    },

    markClean() {
      set({ isDirty: false });
    },

    setValidationErrors(errors) {
      set({ validationErrors: errors });
    },

    clearValidationErrors() {
      set({ validationErrors: {} });
    },

    resetState(partial) {
      set({
        ...initialState,
        ...partial,
        isDirty: false,
        undoStack: [],
        redoStack: [],
      });
    },
  }),
);
