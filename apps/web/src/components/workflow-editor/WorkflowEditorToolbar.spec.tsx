import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { WorkflowEditorToolbar } from "./WorkflowEditorToolbar";
import { useWorkflowEditorStore } from "./hooks/useWorkflowEditorStore";
import type { EditorAction } from "./hooks/useWorkflowEditorStore.types";

function makeAction(): EditorAction {
  return {
    type: "add_node",
    payload: null,
    inverse: () => makeAction(),
  };
}

function makeNode(id: string): Node {
  return {
    id,
    type: "job",
    position: { x: 100, y: 100 },
    data: { label: `Job ${id}`, jobType: "execution", jobId: id },
  };
}

function makeEdge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
    type: "dependency",
    data: { kind: "dependency" },
  };
}

function renderToolbar(
  props: Partial<{
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFitView: () => void;
    onAutoLayout: () => void;
    onToggleYamlPreview: () => void;
  }> = {},
) {
  const defaultProps = {
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFitView: vi.fn(),
    onAutoLayout: vi.fn(),
    onToggleYamlPreview: vi.fn(),
    ...props,
  };
  return render(<WorkflowEditorToolbar {...defaultProps} />);
}

describe("WorkflowEditorToolbar", () => {
  beforeEach(() => {
    useWorkflowEditorStore.setState({
      undoStack: [],
      redoStack: [],
      nodes: [],
      edges: [],
      selectedElementId: null,
    });
  });

  it("renders Undo button", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: /undo/i })).toBeTruthy();
  });

  it("renders Redo button", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: /redo/i })).toBeTruthy();
  });

  it("renders Zoom In button", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: /zoom in/i })).toBeTruthy();
  });

  it("renders Zoom Out button", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: /zoom out/i })).toBeTruthy();
  });

  it("renders Fit View button", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: /fit view/i })).toBeTruthy();
  });

  it("renders Auto Layout button", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: /auto layout/i })).toBeTruthy();
  });

  it("renders YAML Preview toggle button", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: /yaml preview/i })).toBeTruthy();
  });

  it("renders Delete selected button", () => {
    renderToolbar();
    expect(
      screen.getByRole("button", { name: /delete selected/i }),
    ).toBeTruthy();
  });

  it("disables Undo when undoStack is empty", () => {
    useWorkflowEditorStore.setState({ undoStack: [] });
    renderToolbar();

    const undoButton = screen.getByRole("button", {
      name: /undo/i,
    }) as HTMLButtonElement;
    expect(undoButton.disabled).toBe(true);
  });

  it("enables Undo when undoStack has entries", () => {
    useWorkflowEditorStore.setState({ undoStack: [makeAction()] });
    renderToolbar();

    const undoButton = screen.getByRole("button", {
      name: /undo/i,
    }) as HTMLButtonElement;
    expect(undoButton.disabled).toBe(false);
  });

  it("disables Redo when redoStack is empty", () => {
    useWorkflowEditorStore.setState({ redoStack: [] });
    renderToolbar();

    const redoButton = screen.getByRole("button", {
      name: /redo/i,
    }) as HTMLButtonElement;
    expect(redoButton.disabled).toBe(true);
  });

  it("enables Redo when redoStack has entries", () => {
    useWorkflowEditorStore.setState({ redoStack: [makeAction()] });
    renderToolbar();

    const redoButton = screen.getByRole("button", {
      name: /redo/i,
    }) as HTMLButtonElement;
    expect(redoButton.disabled).toBe(false);
  });

  it("disables Delete selected when no element is selected", () => {
    renderToolbar();

    const deleteButton = screen.getByRole("button", {
      name: /delete selected/i,
    }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
  });

  it("calls the store delete action when Delete selected is clicked", async () => {
    const user = userEvent.setup();
    const nodeA = makeNode("node-a");
    const nodeB = makeNode("node-b");
    const edge = makeEdge("edge-1", "node-a", "node-b");
    useWorkflowEditorStore.setState({
      nodes: [nodeA, nodeB],
      edges: [edge],
      selectedElementId: "node-a",
    });

    renderToolbar();

    await user.click(screen.getByRole("button", { name: /delete selected/i }));

    const state = useWorkflowEditorStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.edges).toHaveLength(0);
    expect(state.selectedElementId).toBeNull();
    expect(state.undoStack).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /undo/i }));

    const afterUndo = useWorkflowEditorStore.getState();
    expect(afterUndo.nodes).toHaveLength(2);
    expect(afterUndo.edges).toHaveLength(1);
    expect(afterUndo.undoStack).toHaveLength(0);
    expect(afterUndo.redoStack).toHaveLength(1);
  });

  it("calls store undo when Undo button is clicked", async () => {
    const user = userEvent.setup();
    useWorkflowEditorStore.setState({ undoStack: [makeAction()] });
    const undoSpy = vi.spyOn(useWorkflowEditorStore.getState(), "undo");
    renderToolbar();

    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(undoSpy).toHaveBeenCalledOnce();
  });

  it("calls store redo when Redo button is clicked", async () => {
    const user = userEvent.setup();
    useWorkflowEditorStore.setState({ redoStack: [makeAction()] });
    const redoSpy = vi.spyOn(useWorkflowEditorStore.getState(), "redo");
    renderToolbar();

    await user.click(screen.getByRole("button", { name: /redo/i }));
    expect(redoSpy).toHaveBeenCalledOnce();
  });

  it("calls onZoomIn when Zoom In button is clicked", async () => {
    const user = userEvent.setup();
    const onZoomIn = vi.fn();
    renderToolbar({ onZoomIn });

    await user.click(screen.getByRole("button", { name: /zoom in/i }));
    expect(onZoomIn).toHaveBeenCalledOnce();
  });

  it("calls onZoomOut when Zoom Out button is clicked", async () => {
    const user = userEvent.setup();
    const onZoomOut = vi.fn();
    renderToolbar({ onZoomOut });

    await user.click(screen.getByRole("button", { name: /zoom out/i }));
    expect(onZoomOut).toHaveBeenCalledOnce();
  });

  it("calls onFitView when Fit View button is clicked", async () => {
    const user = userEvent.setup();
    const onFitView = vi.fn();
    renderToolbar({ onFitView });

    await user.click(screen.getByRole("button", { name: /fit view/i }));
    expect(onFitView).toHaveBeenCalledOnce();
  });

  it("calls onAutoLayout when Auto Layout button is clicked", async () => {
    const user = userEvent.setup();
    const onAutoLayout = vi.fn();
    renderToolbar({ onAutoLayout });

    await user.click(screen.getByRole("button", { name: /auto layout/i }));
    expect(onAutoLayout).toHaveBeenCalledOnce();
  });

  it("calls onToggleYamlPreview when YAML Preview button is clicked", async () => {
    const user = userEvent.setup();
    const onToggleYamlPreview = vi.fn();
    renderToolbar({ onToggleYamlPreview });

    await user.click(screen.getByRole("button", { name: /yaml preview/i }));
    expect(onToggleYamlPreview).toHaveBeenCalledOnce();
  });
});
