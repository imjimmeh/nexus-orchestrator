import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { Node } from "@xyflow/react";
import type { EditorAction } from "../../hooks/useWorkflowEditorStore.types";

export function splitTrim(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function makeNodeUpdateAction(
  nodeId: string,
  previousData: Record<string, unknown>,
  newData: Record<string, unknown>,
): EditorAction {
  return {
    type: "update_node_data",
    payload: { nodeId },
    inverse: () => {
      const currentNodes = useWorkflowEditorStore.getState().nodes;
      useWorkflowEditorStore
        .getState()
        .setNodes(
          currentNodes.map((n: Node) =>
            n.id !== nodeId ? n : { ...n, data: previousData },
          ),
        );
      return makeNodeUpdateAction(nodeId, newData, previousData);
    },
  };
}

export function updateNodeData(
  nodeId: string,
  partial: Record<string, unknown>,
  nodes: Node[],
  setNodes: (nodes: Node[]) => void,
  pushAction: (action: EditorAction) => void,
) {
  const previousNode = nodes.find((n) => n.id === nodeId);
  if (!previousNode) return;
  const previousData = { ...previousNode.data };
  const newData = { ...previousNode.data, ...partial };

  setNodes(nodes.map((n) => (n.id !== nodeId ? n : { ...n, data: newData })));

  pushAction(makeNodeUpdateAction(nodeId, previousData, newData));
}
