import { Badge } from "@/components/ui/badge";
import { WorkflowNodeRuntimeStatus } from "@/lib/api/workflows.types";
import { getWorkflowNodeStatusAppearance } from "@/lib/workflow-status";

interface WorkflowNodeStatusBadgeProps {
  status: WorkflowNodeRuntimeStatus | null | undefined;
  className?: string;
}

export function WorkflowNodeStatusBadge({
  status,
  className,
}: Readonly<WorkflowNodeStatusBadgeProps>) {
  const appearance = getWorkflowNodeStatusAppearance(status);

  return (
    <Badge variant={appearance.variant} className={className}>
      {appearance.label}
    </Badge>
  );
}
