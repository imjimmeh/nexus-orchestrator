import { WorkflowNodeStatusBadge } from "@/components/workflow/WorkflowNodeStatusBadge";
import { WorkflowNodeRuntimeStatus } from "@/lib/api/workflows.types";

const LEGEND_STATUSES: WorkflowNodeRuntimeStatus[] = [
  "idle",
  "queued",
  "running",
  "waiting_input",
  "blocked",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
];

export function WorkflowGraphLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {LEGEND_STATUSES.map((status) => (
        <WorkflowNodeStatusBadge key={status} status={status} />
      ))}
    </div>
  );
}
