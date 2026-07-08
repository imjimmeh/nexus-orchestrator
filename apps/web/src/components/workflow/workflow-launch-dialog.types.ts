import { WorkflowLaunchSource } from "@/lib/api/workflow-launch.types";

interface WorkflowLaunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  workflowName: string;
  fixedProjectId?: string;
  initialTriggerData?: Record<string, unknown> | null;
  initialWorkItemId?: string;
  defaultLaunchSource?: WorkflowLaunchSource;
  onLaunched?: (params: { runId: string | null }) => void;
}

export type { WorkflowLaunchDialogProps };
