import { memo, useCallback, useEffect, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import { StepNode } from "./StepNode";
import { JOB_TYPE_CONFIG } from "./node-types";
import type {
  JobNode as JobNodeType,
  StepNode as StepNodeType,
} from "../serialization/types";
import { useWorkflowEditorStore } from "../hooks/useWorkflowEditorStore";

type NodeWithDisplayProps = {
  isConnectable?: boolean;
  positionAbsoluteX?: number;
  positionAbsoluteY?: number;
};

function buildStepNodeProps(stepNode: StepNodeType) {
  const extra = stepNode as StepNodeType & NodeWithDisplayProps;
  return {
    id: stepNode.id,
    type: "step" as const,
    data: stepNode.data,
    dragging: false,
    zIndex: stepNode.zIndex ?? 0,
    selectable: stepNode.selectable ?? true,
    deletable: stepNode.deletable ?? true,
    selected: false,
    draggable: stepNode.draggable ?? true,
    isConnectable: extra.isConnectable ?? true,
    positionAbsoluteX: extra.positionAbsoluteX ?? stepNode.position.x,
    positionAbsoluteY: extra.positionAbsoluteY ?? stepNode.position.y,
    width: stepNode.width,
    height: stepNode.height,
    sourcePosition: stepNode.sourcePosition,
    targetPosition: stepNode.targetPosition,
    dragHandle: stepNode.dragHandle,
    parentId: stepNode.parentId,
  };
}

function ExecutionJobNodeUI({ id, data, selected }: NodeProps<JobNodeType>) {
  const nodeData = data;
  const config = JOB_TYPE_CONFIG[nodeData.jobType];
  const IconComponent = config.icon;
  const [expanded, setExpanded] = useState(false);

  const nodes = useWorkflowEditorStore((s) => s.nodes);
  const setNodes = useWorkflowEditorStore((s) => s.setNodes);

  const childStepNodes = nodes.filter(
    (n) => n.parentId === id,
  ) as StepNodeType[];

  useEffect(() => {
    const needsUpdate = nodes.some(
      (n) => n.parentId === id && (n.hidden ?? false) === expanded,
    );
    if (!needsUpdate) return;

    setNodes(
      nodes.map((n) => (n.parentId === id ? { ...n, hidden: !expanded } : n)),
    );
  }, [expanded, nodes, id, setNodes]);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <BaseNode
      icon={<IconComponent className="h-4 w-4" />}
      label={nodeData.label}
      accentColor={config.color}
      selected={selected}
      footer={
        <button
          onClick={handleToggle}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      }
    >
      <p className="text-[10px] text-muted-foreground truncate">
        {nodeData.jobId}
      </p>
      {expanded && (
        <div className="mt-2 border-t pt-2 space-y-2">
          {childStepNodes.map((stepNode) => (
            <StepNode key={stepNode.id} {...buildStepNodeProps(stepNode)} />
          ))}
          {childStepNodes.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              No steps defined
            </p>
          )}
        </div>
      )}
    </BaseNode>
  );
}

export const ExecutionJobNode = memo(ExecutionJobNodeUI);
