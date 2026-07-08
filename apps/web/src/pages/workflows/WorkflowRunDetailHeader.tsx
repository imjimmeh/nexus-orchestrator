import { ArrowLeft, Loader2, Wifi, WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { Button } from "@/components/ui/button";
import { formatDateSafe } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";

function formatDuration(
  startedAt?: string | null,
  completedAt?: string | null,
): string {
  const start = startedAt ? new Date(startedAt).getTime() : 0;
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (!start) return "-";
  const diff = Math.max(0, end - start);
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function ConnectionStatus({
  connectionState,
}: Readonly<{ connectionState: string }>) {
  if (connectionState === "connected") {
    return (
      <>
        <Wifi className="h-4 w-4 text-success" /> Live
      </>
    );
  }

  return (
    <>
      <WifiOff className="h-4 w-4" /> {connectionState}
    </>
  );
}

interface WorkflowRunDetailHeaderProps {
  run: WorkflowRun;
  workflowId?: string;
  connectionState: string;
  activeSessionPath?: string;
  onBack: () => void;
  onAbortRun?: () => void;
  isAbortRunPending?: boolean;
  onRestartOrchestration?: () => void;
  isRestartOrchestrationPending?: boolean;
  onRestartWorkItemWorkflow?: () => void;
  isRestartWorkItemWorkflowPending?: boolean;
  onRerunOriginalWorkflow?: () => void;
  isRerunOriginalWorkflowPending?: boolean;
}

export function WorkflowRunDetailHeader({
  run,
  workflowId,
  connectionState,
  activeSessionPath,
  onBack,
  onAbortRun,
  isAbortRunPending,
  onRestartOrchestration,
  isRestartOrchestrationPending,
  onRestartWorkItemWorkflow,
  isRestartWorkItemWorkflowPending,
  onRerunOriginalWorkflow,
  isRerunOriginalWorkflowPending,
}: Readonly<WorkflowRunDetailHeaderProps>) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">
          Execution {run.id.slice(0, 8)}…
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={run.status} />
          <span className="text-sm text-muted-foreground">
            Started{" "}
            {formatDateSafe(
              run.created_at,
              "MMM d, yyyy HH:mm:ss",
              "Unknown time",
            )}
          </span>
          <span className="text-sm text-muted-foreground">
            · Duration {formatDuration(run.started_at, run.completed_at)}
          </span>
          {workflowId && (
            <span className="text-sm">
              <Link
                to={`/workflows/${workflowId}`}
                className="text-primary hover:underline"
              >
                View workflow
              </Link>
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 lg:items-end">
        <div className="flex flex-wrap items-center gap-2">
          {activeSessionPath && (
            <Button variant="outline" size="sm" asChild>
              <Link to={activeSessionPath}>Open Session Workspace</Link>
            </Button>
          )}
          {onAbortRun && (
            <Button
              variant="destructive"
              size="sm"
              onClick={onAbortRun}
              disabled={isAbortRunPending}
            >
              {isAbortRunPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Abort Run
            </Button>
          )}
          {onRestartOrchestration && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRestartOrchestration}
              disabled={isRestartOrchestrationPending}
            >
              {isRestartOrchestrationPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Restart Orchestration
            </Button>
          )}
          {onRestartWorkItemWorkflow && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onRestartWorkItemWorkflow}
              disabled={isRestartWorkItemWorkflowPending}
            >
              {isRestartWorkItemWorkflowPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Restart Work Item Workflow
            </Button>
          )}
          {onRerunOriginalWorkflow && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRerunOriginalWorkflow}
              disabled={isRerunOriginalWorkflowPending}
            >
              {isRerunOriginalWorkflowPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Rerun With Edits
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ConnectionStatus connectionState={connectionState} />
        </div>
      </div>
    </div>
  );
}
