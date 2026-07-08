import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { GraphNodeCard } from "@/components/workflow/GraphNodeCard";
import { STEP_TYPE_CONFIG } from "./node-types";
import type { StepNode as StepNodeType } from "../serialization/types";

function StepNodeUI({ data, selected }: NodeProps<StepNodeType>) {
  const nodeData = data;
  const config = STEP_TYPE_CONFIG[nodeData.stepType];
  const IconComponent = config.icon;

  let preview: string | undefined;
  if (nodeData.prompt) {
    preview = nodeData.prompt;
  } else if (nodeData.command) {
    preview = nodeData.command;
  } else if (nodeData.variables) {
    preview = Object.keys(nodeData.variables).join(", ");
  }

  return (
    <GraphNodeCard
      icon={<IconComponent className="h-3 w-3 text-muted-foreground" />}
      typeLabel={config.label}
      title={nodeData.label}
      accentColor={config.color}
      secondaryText={nodeData.stepId}
      preview={preview}
      selected={selected}
      compact
    />
  );
}

export const StepNode = memo(StepNodeUI);
