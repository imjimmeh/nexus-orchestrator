import { memo } from "react";
import { type NodeProps } from "@xyflow/react";
import { GraphNodeCard } from "@/components/workflow/GraphNodeCard";
import { JOB_TYPE_CONFIG } from "./node-types";
import type { JobNode as JobNodeType } from "../serialization/types";

function JobNodeUI({ data, selected }: NodeProps<JobNodeType>) {
  const nodeData = data;
  const config = JOB_TYPE_CONFIG[nodeData.jobType];
  const IconComponent = config.icon;

  const summaryInfo = nodeData.jobType === "execution" ? "0 steps" : undefined;

  return (
    <GraphNodeCard
      icon={<IconComponent className="h-4 w-4" />}
      typeLabel={config.label}
      title={nodeData.label}
      accentColor={config.color}
      secondaryText={nodeData.jobId}
      tier={nodeData.tier}
      selected={selected}
      footer={
        summaryInfo ? (
          <p className="text-[10px] text-muted-foreground">{summaryInfo}</p>
        ) : undefined
      }
    />
  );
}

export const JobNode = memo(JobNodeUI);
