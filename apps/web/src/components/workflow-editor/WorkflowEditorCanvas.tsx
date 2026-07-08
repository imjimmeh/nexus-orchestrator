import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import {
  useWorkflowEditorStore,
  createAddEdgeAction,
  createAddNodeAction,
} from "./hooks/useWorkflowEditorStore";
import type { EditorAction } from "./hooks/useWorkflowEditorStore.types";
import { JOB_TYPE_CONFIG } from "./nodes/node-types";
import type { JobNodeData } from "./serialization/types";

export function createConnectionHandler(
  edges: Edge[],
  setEdges: (edges: Edge[]) => void,
  pushAction: (action: EditorAction) => void,
): (connection: Connection) => void {
  return (connection: Connection) => {
    if (!connection.source || !connection.target) return;

    const duplicate = edges.some(
      (e) => e.source === connection.source && e.target === connection.target,
    );
    if (duplicate) return;

    const newEdge: Edge = {
      id: `edge-${connection.source}-${connection.target}`,
      source: connection.source,
      target: connection.target,
      type: "dependency",
      data: { kind: "dependency" },
    };

    pushAction(createAddEdgeAction(newEdge, edges.length));

    setEdges(addEdge(newEdge, edges));
  };
}

interface WorkflowEditorCanvasProps {
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
}

export function createSelectionChangeHandler(
  setSelectedElementId: (id: string | null) => void,
  selectionState: { current: boolean } = { current: false },
): (selection: { nodes: Node[]; edges: Edge[] }) => void {
  return ({ nodes, edges }) => {
    const selectedEdge = edges[0];
    if (selectedEdge) {
      selectionState.current = true;
      setSelectedElementId(selectedEdge.id);
      return;
    }

    const selectedNode = nodes[0];
    if (selectedNode) {
      selectionState.current = true;
      setSelectedElementId(selectedNode.id);
      return;
    }

    if (selectionState.current) {
      setSelectedElementId(null);
    }
  };
}

export function WorkflowEditorCanvas({
  nodeTypes,
  edgeTypes,
}: WorkflowEditorCanvasProps) {
  const nodes = useWorkflowEditorStore((s) => s.nodes);
  const edges = useWorkflowEditorStore((s) => s.edges);
  const setNodes = useWorkflowEditorStore((s) => s.setNodes);
  const setEdges = useWorkflowEditorStore((s) => s.setEdges);
  const setSelectedElementId = useWorkflowEditorStore(
    (s) => s.setSelectedElementId,
  );
  const deleteSelectedElement = useWorkflowEditorStore(
    (s) => s.deleteSelectedElement,
  );
  const pushAction = useWorkflowEditorStore((s) => s.pushAction);
  const selectedElementId = useWorkflowEditorStore((s) => s.selectedElementId);
  const hasSelectionRef = useRef(false);

  const reactFlowInstance = useReactFlow();

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes(applyNodeChanges(changes, nodes));
    },
    [nodes, setNodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges(applyEdgeChanges(changes, edges));
    },
    [edges, setEdges],
  );

  const onConnect = useCallback(
    createConnectionHandler(edges, setEdges, pushAction),
    [edges, setEdges, pushAction],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      hasSelectionRef.current = true;
      setSelectedElementId(node.id);
    },
    [setSelectedElementId],
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      hasSelectionRef.current = true;
      setSelectedElementId(edge.id);
    },
    [setSelectedElementId],
  );

  const onPaneClick = useCallback(() => {
    hasSelectionRef.current = false;
    setSelectedElementId(null);
  }, [setSelectedElementId]);

  const onSelectionChange = useCallback(
    createSelectionChangeHandler(setSelectedElementId, hasSelectionRef),
    [setSelectedElementId],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      )
        return;

      if (!selectedElementId) return;

      deleteSelectedElement();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedElementId, deleteSelectedElement]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const jobType = event.dataTransfer.getData("application/reactflow");
      if (!jobType) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const jobId = `job-${Date.now()}`;

      const newNode: Node<JobNodeData> = {
        id: jobId,
        type: "job",
        position,
        data: {
          label:
            JOB_TYPE_CONFIG[jobType as keyof typeof JOB_TYPE_CONFIG]?.label ??
            jobType,
          jobType: jobType as JobNodeData["jobType"],
          jobId,
        },
      };

      pushAction(createAddNodeAction(newNode, nodes.length));

      setNodes([...nodes, newNode]);
    },
    [nodes, setNodes, pushAction, reactFlowInstance],
  );

  const fitViewOptions = useMemo(() => ({ padding: 0.2 }), []);

  return (
    <div className="flex-1 h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onSelectionChange={onSelectionChange}
        onDragOver={onDragOver}
        onDrop={onDrop}
        fitView
        fitViewOptions={fitViewOptions}
        connectionLineStyle={{ stroke: "#999", strokeWidth: 2 }}
        deleteKeyCode={null}
      >
        <Background />
        <MiniMap />
        <Controls />
      </ReactFlow>
    </div>
  );
}
