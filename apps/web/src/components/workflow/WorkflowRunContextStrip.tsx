import { Link } from "react-router-dom";
import { WorkflowStatusBadge } from "./WorkflowStatusBadge";
import { isActiveWorkflowRunStatus } from "@/lib/workflow-status";
import { WorkflowRun } from "@/lib/api/workflows.types";

interface WorkflowRunContextStripProps {
  workflowId: string;
  runs: WorkflowRun[];
  selectedRunId?: string;
  onRunChange?: (runId: string) => void;
}

function RunEmptyState() {
  return (
    <p className="text-sm text-muted-foreground">No workflow run selected</p>
  );
}

export function WorkflowRunContextStrip({
  workflowId,
  runs,
  selectedRunId,
  onRunChange,
}: Readonly<WorkflowRunContextStripProps>) {
  const selectedRun = runs.find((run) => run.id === selectedRunId);

  if (!selectedRun) {
    return (
      <div className="rounded-lg border bg-card px-4 py-3">
        <RunEmptyState />
      </div>
    );
  }

  const isActiveRun = isActiveWorkflowRunStatus(selectedRun.status);

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p className="text-muted-foreground">
            {isActiveRun ? "Currently executing run" : "Viewing run"}
          </p>
          <Link
            to={`/workflows/${workflowId}/runs/${selectedRun.id}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {selectedRun.id}
          </Link>
          <WorkflowStatusBadge
            status={selectedRun.status}
            className="shrink-0"
          />
        </div>

        {runs.length > 1 && onRunChange ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Run</span>
            <select
              value={selectedRun.id}
              onChange={(event) => {
                onRunChange(event.target.value);
              }}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.display_name ?? run.id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </div>
  );
}
