import { WorkflowRunStatus } from "@/lib/api/common.types";
import { WorkflowNodeRuntimeStatus } from "@/lib/api/workflows.types";

type WorkflowBadgeVariant = "default" | "secondary" | "destructive" | "outline";

interface WorkflowStatusAppearance {
  label: string;
  variant: WorkflowBadgeVariant;
}

const RUN_STATUS_APPEARANCE: Record<
  WorkflowRunStatus,
  WorkflowStatusAppearance
> = {
  PENDING: { label: "Pending", variant: "secondary" },
  RUNNING: { label: "Running", variant: "default" },
  COMPLETED: { label: "Completed", variant: "default" },
  FAILED: { label: "Failed", variant: "destructive" },
  CANCELLED: { label: "Cancelled", variant: "outline" },
};

const NODE_STATUS_APPEARANCE: Record<
  WorkflowNodeRuntimeStatus,
  WorkflowStatusAppearance
> = {
  idle: { label: "Idle", variant: "outline" },
  queued: { label: "Queued", variant: "secondary" },
  running: { label: "Running", variant: "default" },
  blocked: { label: "Blocked", variant: "destructive" },
  waiting_input: { label: "Waiting Input", variant: "secondary" },
  succeeded: { label: "Succeeded", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
  skipped: { label: "Skipped", variant: "outline" },
};

export function getWorkflowRunStatusAppearance(
  status: WorkflowRunStatus | null | undefined,
): WorkflowStatusAppearance {
  if (!status) {
    return {
      label: "Unknown",
      variant: "outline",
    };
  }

  return RUN_STATUS_APPEARANCE[status];
}

export function getWorkflowNodeStatusAppearance(
  status: WorkflowNodeRuntimeStatus | null | undefined,
): WorkflowStatusAppearance {
  if (!status) {
    return {
      label: "Unknown",
      variant: "outline",
    };
  }

  return NODE_STATUS_APPEARANCE[status];
}

export function isActiveWorkflowRunStatus(
  status: WorkflowRunStatus | null | undefined,
): boolean {
  return status === "PENDING" || status === "RUNNING";
}
