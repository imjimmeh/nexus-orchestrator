import { describe, it, expect, beforeEach } from "vitest";
import {
  useWorkflowEditorStore,
  createAddEdgeAction,
  createAddNodeAction,
} from "./useWorkflowEditorStore";
import type { Node, Edge } from "@xyflow/react";
import type { EditorAction } from "./useWorkflowEditorStore.types";

function makeNode(id: string): Node {
  return {
    id,
    type: "default",
    position: { x: 0, y: 0 },
    data: { label: `Node ${id}` },
  };
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

function makeAction(payload: unknown = "test-payload"): EditorAction {
  return {
    type: "update_metadata",
    payload,
    inverse: () => makeAction(`inverse-${payload}`),
  };
}

describe("useWorkflowEditorStore", () => {
  beforeEach(() => {
    useWorkflowEditorStore.getState().resetState({});
  });

  describe("initialization", () => {
    it("has default workflowId as empty string", () => {
      expect(useWorkflowEditorStore.getState().workflowId).toBe("");
    });

    it("has default name as empty string", () => {
      expect(useWorkflowEditorStore.getState().name).toBe("");
    });

    it("has default description as empty string", () => {
      expect(useWorkflowEditorStore.getState().description).toBe("");
    });

    it("has default active as true", () => {
      expect(useWorkflowEditorStore.getState().active).toBe(true);
    });

    it("has default trigger as null", () => {
      expect(useWorkflowEditorStore.getState().trigger).toBeNull();
    });

    it("has default concurrency as null", () => {
      expect(useWorkflowEditorStore.getState().concurrency).toBeNull();
    });

    it("has default globalEnv as empty object", () => {
      expect(useWorkflowEditorStore.getState().globalEnv).toEqual({});
    });

    it("has default permissions as null", () => {
      expect(useWorkflowEditorStore.getState().permissions).toBeNull();
    });

    it("has default strictDependencies as false", () => {
      expect(useWorkflowEditorStore.getState().strictDependencies).toBe(false);
    });

    it("has default nodes as empty array", () => {
      expect(useWorkflowEditorStore.getState().nodes).toEqual([]);
    });

    it("has default edges as empty array", () => {
      expect(useWorkflowEditorStore.getState().edges).toEqual([]);
    });

    it("has default selectedElementId as null", () => {
      expect(useWorkflowEditorStore.getState().selectedElementId).toBeNull();
    });

    it("has default isDirty as false", () => {
      expect(useWorkflowEditorStore.getState().isDirty).toBe(false);
    });

    it("has default undoStack as empty array", () => {
      expect(useWorkflowEditorStore.getState().undoStack).toEqual([]);
    });

    it("has default redoStack as empty array", () => {
      expect(useWorkflowEditorStore.getState().redoStack).toEqual([]);
    });
  });

  describe("setMetadata", () => {
    it("updates name and marks dirty", () => {
      const store = useWorkflowEditorStore.getState();
      store.setMetadata({ name: "New Workflow" });
      expect(useWorkflowEditorStore.getState().name).toBe("New Workflow");
      expect(useWorkflowEditorStore.getState().isDirty).toBe(true);
    });

    it("merges partial metadata without overwriting unspecified fields", () => {
      const store = useWorkflowEditorStore.getState();
      store.setMetadata({ workflowId: "wf-123" });
      store.markClean();
      store.setMetadata({ name: "Updated" });
      expect(useWorkflowEditorStore.getState().workflowId).toBe("wf-123");
      expect(useWorkflowEditorStore.getState().name).toBe("Updated");
    });
  });

  describe("setNodes", () => {
    it("sets nodes and marks dirty", () => {
      const nodes: Node[] = [makeNode("a"), makeNode("b")];
      useWorkflowEditorStore.getState().setNodes(nodes);
      expect(useWorkflowEditorStore.getState().nodes).toEqual(nodes);
      expect(useWorkflowEditorStore.getState().isDirty).toBe(true);
    });
  });

  describe("setEdges", () => {
    it("sets edges and marks dirty", () => {
      const edges: Edge[] = [makeEdge("e1", "a", "b")];
      useWorkflowEditorStore.getState().setEdges(edges);
      expect(useWorkflowEditorStore.getState().edges).toEqual(edges);
      expect(useWorkflowEditorStore.getState().isDirty).toBe(true);
    });
  });

  describe("setSelectedElementId", () => {
    it("sets selectedElementId without marking dirty", () => {
      const store = useWorkflowEditorStore.getState();
      store.setMetadata({ name: "dirty-test" });
      store.markClean();
      store.setSelectedElementId("node-abc");
      expect(useWorkflowEditorStore.getState().selectedElementId).toBe(
        "node-abc",
      );
      expect(useWorkflowEditorStore.getState().isDirty).toBe(false);
    });

    it("allows setting to null", () => {
      useWorkflowEditorStore.getState().setSelectedElementId("node-xyz");
      useWorkflowEditorStore.getState().setSelectedElementId(null);
      expect(useWorkflowEditorStore.getState().selectedElementId).toBeNull();
    });
  });

  describe("pushAction", () => {
    it("pushes action to undoStack and clears redoStack", () => {
      const store = useWorkflowEditorStore.getState();
      store.pushAction(makeAction("first"));
      store.pushAction(makeAction("second"));
      expect(useWorkflowEditorStore.getState().undoStack).toHaveLength(2);
      expect(useWorkflowEditorStore.getState().redoStack).toEqual([]);
    });

    it("marks dirty", () => {
      useWorkflowEditorStore.getState().markClean();
      useWorkflowEditorStore.getState().pushAction(makeAction("dirty"));
      expect(useWorkflowEditorStore.getState().isDirty).toBe(true);
    });

    it("clears redoStack on new action", () => {
      const store = useWorkflowEditorStore.getState();
      store.pushAction(makeAction("a"));
      store.undo();
      expect(useWorkflowEditorStore.getState().redoStack).not.toHaveLength(0);
      store.pushAction(makeAction("b"));
      expect(useWorkflowEditorStore.getState().redoStack).toEqual([]);
    });
  });

  describe("undo", () => {
    it("is a no-op when undoStack is empty", () => {
      const store = useWorkflowEditorStore.getState();
      store.undo();
      expect(useWorkflowEditorStore.getState().undoStack).toEqual([]);
      expect(useWorkflowEditorStore.getState().redoStack).toEqual([]);
    });

    it("pops undo action, calls its inverse, pushes inverse result to redoStack", () => {
      const store = useWorkflowEditorStore.getState();
      store.pushAction(makeAction("one"));
      store.pushAction(makeAction("two"));
      store.undo();
      expect(useWorkflowEditorStore.getState().undoStack).toHaveLength(1);
      expect(useWorkflowEditorStore.getState().redoStack).toHaveLength(1);
      expect(useWorkflowEditorStore.getState().redoStack[0].payload).toBe(
        "inverse-two",
      );
    });

    it("invokes inverse on the popped action and stores its returned action", () => {
      const store = useWorkflowEditorStore.getState();
      let inverseCalled = false;
      store.pushAction({
        type: "update_metadata",
        payload: "test",
        inverse: () => {
          inverseCalled = true;
          return makeAction("invoked");
        },
      });
      store.undo();
      expect(inverseCalled).toBe(true);
      expect(useWorkflowEditorStore.getState().redoStack[0].payload).toBe(
        "invoked",
      );
    });
  });

  describe("redo", () => {
    it("is a no-op when redoStack is empty", () => {
      const store = useWorkflowEditorStore.getState();
      store.redo();
      expect(useWorkflowEditorStore.getState().undoStack).toEqual([]);
      expect(useWorkflowEditorStore.getState().redoStack).toEqual([]);
    });

    it("pops redo action, calls its inverse, pushes inverse result to undoStack", () => {
      const store = useWorkflowEditorStore.getState();
      store.pushAction(makeAction("first"));
      store.undo();
      expect(useWorkflowEditorStore.getState().redoStack).toHaveLength(1);
      store.redo();
      expect(useWorkflowEditorStore.getState().undoStack).toHaveLength(1);
      expect(useWorkflowEditorStore.getState().redoStack).toEqual([]);
      expect(useWorkflowEditorStore.getState().undoStack[0].payload).toBe(
        "inverse-inverse-first",
      );
    });
  });

  describe("graph action undo/redo", () => {
    it("undoes and redoes a deleted node with connected edges", () => {
      const store = useWorkflowEditorStore.getState();
      const nodeA = makeNode("node-a");
      const nodeB = makeNode("node-b");
      const nodeC = makeNode("node-c");
      const edge1 = makeEdge("edge-1", "node-a", "node-b");
      const edge2 = makeEdge("edge-2", "node-b", "node-c");
      const edge3 = makeEdge("edge-3", "node-a", "node-c");
      store.setNodes([nodeA, nodeB, nodeC]);
      store.setEdges([edge1, edge2, edge3]);
      store.setSelectedElementId("node-a");

      expect(
        useWorkflowEditorStore.getState().nodes.map((node) => node.id),
      ).toEqual(["node-a", "node-b", "node-c"]);
      expect(
        useWorkflowEditorStore.getState().edges.map((edge) => edge.id),
      ).toEqual(["edge-1", "edge-2", "edge-3"]);

      store.deleteSelectedElement();
      expect(
        useWorkflowEditorStore.getState().nodes.map((node) => node.id),
      ).toEqual(["node-b", "node-c"]);
      expect(
        useWorkflowEditorStore.getState().edges.map((edge) => edge.id),
      ).toEqual(["edge-2"]);

      store.undo();
      expect(
        useWorkflowEditorStore.getState().nodes.map((node) => node.id),
      ).toEqual(["node-a", "node-b", "node-c"]);
      expect(
        useWorkflowEditorStore.getState().edges.map((edge) => edge.id),
      ).toEqual(["edge-1", "edge-2", "edge-3"]);

      store.redo();
      expect(
        useWorkflowEditorStore.getState().nodes.map((node) => node.id),
      ).toEqual(["node-b", "node-c"]);
      expect(
        useWorkflowEditorStore.getState().edges.map((edge) => edge.id),
      ).toEqual(["edge-2"]);
    });

    it("undoes and redoes a deleted edge", () => {
      const store = useWorkflowEditorStore.getState();
      const nodeA = makeNode("node-a");
      const nodeB = makeNode("node-b");
      const edge1 = makeEdge("edge-1", "node-a", "node-b");
      const edge2 = makeEdge("edge-2", "node-a", "node-b");
      const edge3 = makeEdge("edge-3", "node-a", "node-b");
      store.setNodes([nodeA, nodeB]);
      store.setEdges([edge1, edge2, edge3]);
      store.setSelectedElementId("edge-2");

      expect(
        useWorkflowEditorStore.getState().edges.map((edge) => edge.id),
      ).toEqual(["edge-1", "edge-2", "edge-3"]);

      store.deleteSelectedElement();
      expect(
        useWorkflowEditorStore.getState().edges.map((edge) => edge.id),
      ).toEqual(["edge-1", "edge-3"]);

      store.undo();
      expect(
        useWorkflowEditorStore.getState().edges.map((edge) => edge.id),
      ).toEqual(["edge-1", "edge-2", "edge-3"]);

      store.redo();
      expect(
        useWorkflowEditorStore.getState().edges.map((edge) => edge.id),
      ).toEqual(["edge-1", "edge-3"]);
    });

    it("undoes and redoes an added node", () => {
      const store = useWorkflowEditorStore.getState();
      const node = makeNode("node-a");

      store.pushAction(createAddNodeAction(node));
      store.setNodes([node]);

      store.undo();
      expect(useWorkflowEditorStore.getState().nodes).toHaveLength(0);

      store.redo();
      expect(useWorkflowEditorStore.getState().nodes).toHaveLength(1);

      store.undo();
      expect(useWorkflowEditorStore.getState().nodes).toHaveLength(0);
    });

    it("undoes and redoes an added edge", () => {
      const store = useWorkflowEditorStore.getState();
      const edge = makeEdge("edge-1", "node-a", "node-b");

      store.pushAction(createAddEdgeAction(edge));
      store.setEdges([edge]);

      store.undo();
      expect(useWorkflowEditorStore.getState().edges).toHaveLength(0);

      store.redo();
      expect(useWorkflowEditorStore.getState().edges).toHaveLength(1);

      store.undo();
      expect(useWorkflowEditorStore.getState().edges).toHaveLength(0);
    });
  });

  describe("undo/redo toggle", () => {
    it("undo restores and redo re-applies real store metadata", () => {
      const store = useWorkflowEditorStore.getState();
      store.setMetadata({ name: "Original" });
      store.markClean();

      store.setMetadata({ name: "Changed" });

      const changeAction: EditorAction = {
        type: "update_metadata",
        payload: "Change name",
        inverse: () => {
          useWorkflowEditorStore.getState().setMetadata({ name: "Original" });
          return {
            type: "update_metadata",
            payload: "Restore name",
            inverse: () => {
              useWorkflowEditorStore
                .getState()
                .setMetadata({ name: "Changed" });
              return {
                type: "update_metadata",
                payload: "Change name",
                inverse: () => {
                  throw new Error("should not loop");
                },
              };
            },
          };
        },
      };
      store.pushAction(changeAction);

      expect(useWorkflowEditorStore.getState().name).toBe("Changed");
      expect(useWorkflowEditorStore.getState().undoStack).toHaveLength(1);

      store.undo();
      expect(useWorkflowEditorStore.getState().name).toBe("Original");
      expect(useWorkflowEditorStore.getState().undoStack).toHaveLength(0);
      expect(useWorkflowEditorStore.getState().redoStack).toHaveLength(1);

      store.redo();
      expect(useWorkflowEditorStore.getState().name).toBe("Changed");
      expect(useWorkflowEditorStore.getState().undoStack).toHaveLength(1);
      expect(useWorkflowEditorStore.getState().redoStack).toHaveLength(0);
    });
  });

  describe("markClean", () => {
    it("sets isDirty to false", () => {
      const store = useWorkflowEditorStore.getState();
      store.setMetadata({ name: "dirty" });
      expect(useWorkflowEditorStore.getState().isDirty).toBe(true);
      store.markClean();
      expect(useWorkflowEditorStore.getState().isDirty).toBe(false);
    });
  });

  describe("validationErrors", () => {
    it("has default validationErrors as empty object", () => {
      expect(useWorkflowEditorStore.getState().validationErrors).toEqual({});
    });

    it("setValidationErrors sets validation errors", () => {
      const errors = {
        "jobs[0].id": "Job id is required",
        name: "Name must be a string",
      };
      useWorkflowEditorStore.getState().setValidationErrors(errors);
      expect(useWorkflowEditorStore.getState().validationErrors).toEqual(
        errors,
      );
    });

    it("clearValidationErrors resets validation errors to empty", () => {
      useWorkflowEditorStore
        .getState()
        .setValidationErrors({ name: "Required" });
      useWorkflowEditorStore.getState().clearValidationErrors();
      expect(useWorkflowEditorStore.getState().validationErrors).toEqual({});
    });

    it("resetState clears validationErrors", () => {
      useWorkflowEditorStore.getState().setValidationErrors({ field: "error" });
      useWorkflowEditorStore.getState().resetState({});
      expect(useWorkflowEditorStore.getState().validationErrors).toEqual({});
    });
  });

  describe("resetState", () => {
    it("applies partial state", () => {
      useWorkflowEditorStore
        .getState()
        .resetState({ workflowId: "wf-reset", name: "Reset Name" });
      expect(useWorkflowEditorStore.getState().workflowId).toBe("wf-reset");
      expect(useWorkflowEditorStore.getState().name).toBe("Reset Name");
      expect(useWorkflowEditorStore.getState().description).toBe("");
    });

    it("resets isDirty to false", () => {
      useWorkflowEditorStore.getState().setMetadata({ name: "dirty" });
      expect(useWorkflowEditorStore.getState().isDirty).toBe(true);
      useWorkflowEditorStore.getState().resetState({});
      expect(useWorkflowEditorStore.getState().isDirty).toBe(false);
    });

    it("clears undoStack and redoStack", () => {
      const store = useWorkflowEditorStore.getState();
      store.pushAction(makeAction("a"));
      store.pushAction(makeAction("b"));
      store.resetState({});
      expect(useWorkflowEditorStore.getState().undoStack).toEqual([]);
      expect(useWorkflowEditorStore.getState().redoStack).toEqual([]);
    });
  });
});
