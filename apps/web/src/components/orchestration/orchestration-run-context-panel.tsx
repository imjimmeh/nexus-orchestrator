import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { WorkflowStatusBadge } from "@/components/workflow/WorkflowStatusBadge";

interface RunContextPanelProps {
  effectiveRunId: string | null | undefined;
  activeSessionHref: string | null;
  workflowRun?: WorkflowRun | null;
}

export function RunContextPanel({
  effectiveRunId,
  activeSessionHref,
  workflowRun,
}: Readonly<RunContextPanelProps>) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="rounded-md border p-3">
        <p className="text-xs text-muted-foreground">Current Run</p>
        <p className="break-all text-sm font-semibold">
          {effectiveRunId ?? "None"}
        </p>
        {activeSessionHref && (
          <Button variant="link" className="h-auto px-0 pt-1 text-xs" asChild>
            <Link to={activeSessionHref}>Go to Active Session</Link>
          </Button>
        )}
        {workflowRun?.id && workflowRun.workflow_id && (
          <Button variant="link" className="h-auto px-0 pt-1 text-xs" asChild>
            <Link
              to={`/workflows/${workflowRun.workflow_id}/runs/${workflowRun.id}`}
            >
              Open Workflow Run
            </Link>
          </Button>
        )}
      </div>
      <div className="rounded-md border p-3">
        <p className="text-xs text-muted-foreground">Run Status</p>
        <div className="pt-1">
          <WorkflowStatusBadge status={workflowRun?.status} />
        </div>
      </div>
      <div className="rounded-md border p-3">
        <p className="text-xs text-muted-foreground">Current Step</p>
        <p className="text-sm font-semibold">
          {workflowRun?.current_step_id ?? "not available"}
        </p>
      </div>
    </div>
  );
}
