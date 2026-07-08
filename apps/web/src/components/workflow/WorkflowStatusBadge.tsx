import { Badge } from "@/components/ui/badge";
import { WorkflowRunStatus } from "@/lib/api/common.types";
import { getWorkflowRunStatusAppearance } from "@/lib/workflow-status";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";

interface WorkflowStatusBadgeProps {
  status: WorkflowRunStatus | null | undefined;
  className?: string;
}

function StatusIcon({
  status,
}: Readonly<{ status: WorkflowRunStatus | null | undefined }>) {
  if (status === "PENDING") {
    return <Clock className="h-3.5 w-3.5" />;
  }

  if (status === "RUNNING") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }

  if (status === "COMPLETED") {
    return <CheckCircle2 className="h-3.5 w-3.5" />;
  }

  if (status === "FAILED") {
    return <XCircle className="h-3.5 w-3.5" />;
  }

  if (status === "CANCELLED") {
    return <AlertCircle className="h-3.5 w-3.5" />;
  }

  return <Clock className="h-3.5 w-3.5" />;
}

export function WorkflowStatusBadge({
  status,
  className,
}: Readonly<WorkflowStatusBadgeProps>) {
  const appearance = getWorkflowRunStatusAppearance(status);

  return (
    <Badge variant={appearance.variant} className={className}>
      <span className="mr-1.5 inline-flex items-center">
        <StatusIcon status={status} />
      </span>
      {appearance.label}
    </Badge>
  );
}
