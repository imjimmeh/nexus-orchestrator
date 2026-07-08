import { Link, useNavigate } from "react-router-dom";
import {
  WORKFLOW_RUNS_SORT_COLUMNS,
  type WorkflowRunsSortColumn,
} from "@nexus/core";
import { DataTable } from "@/components/ui/data-table";
import type { ColumnDef, ListResponse } from "@/components/ui/data-table";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { WorkflowStatusBadge } from "@/components/workflow/WorkflowStatusBadge";
import { formatDateSafe, formatDistanceToNowSafe } from "@/lib/utils";

interface ExecutionLogsProps {
  readonly runs?: WorkflowRun[];
  readonly workflowId: string;
}

function calculateDuration(run: WorkflowRun): string | null {
  if (!run.started_at) return null;
  if (!run.completed_at) {
    if (run.status === "RUNNING" || run.status === "PENDING") {
      return formatDistanceToNowSafe(run.started_at, "-", { addSuffix: false });
    }
    return null;
  }

  const start = new Date(run.started_at);
  const end = new Date(run.completed_at);
  const diffMs = end.getTime() - start.getTime();
  const diffSecs = Math.round(diffMs / 1000);

  if (diffSecs < 60) return `${diffSecs}s`;
  const diffMins = Math.round(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.round(diffMins / 60);
  return `${diffHours}h ${diffMins % 60}m`;
}

function getLinkedWorkItemId(run: WorkflowRun): string | null {
  const trigger =
    run.state_variables && typeof run.state_variables === "object"
      ? run.state_variables.trigger
      : undefined;

  const triggerRecord =
    trigger && typeof trigger === "object"
      ? (trigger as Record<string, unknown>)
      : undefined;

  const workItemId = triggerRecord?.workItemId;
  if (typeof workItemId === "string" && workItemId.length > 0) {
    return workItemId;
  }

  return null;
}

function toWorkflowRunsSortColumn(
  value: unknown,
): WorkflowRunsSortColumn | undefined {
  return typeof value === "string" &&
    (WORKFLOW_RUNS_SORT_COLUMNS as readonly string[]).includes(value)
    ? (value as WorkflowRunsSortColumn)
    : undefined;
}

export function ExecutionLogs({ workflowId }: Readonly<ExecutionLogsProps>) {
  const navigate = useNavigate();

  const columns: ColumnDef<WorkflowRun>[] = [
    {
      key: "id",
      label: "Run ID",
      render: (run) => (
        <span className="font-mono">{run.id.slice(0, 8)}...</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (run) => <WorkflowStatusBadge status={run.status} />,
    },
    {
      key: "created_at",
      label: "Started",
      sortable: true,
      render: (run) =>
        formatDateSafe(run.created_at, "MMM d, yyyy HH:mm", "Unknown time"),
    },
    {
      key: "started_at",
      label: "Duration",
      render: (run) => calculateDuration(run) ?? "-",
    },
    {
      key: "workflow_id",
      label: "Work Item",
      render: (run) => {
        const linkedId = getLinkedWorkItemId(run);
        return linkedId ? (
          <span className="font-mono text-xs">{linkedId}</span>
        ) : (
          "-"
        );
      },
    },
    {
      key: "id",
      label: "Actions",
      className: "text-right",
      render: (run) => (
        <Button asChild variant="outline" size="sm">
          <Link to={`/workflows/${workflowId}/runs/${run.id}`}>
            View details
          </Link>
        </Button>
      ),
    },
  ];

  const fetchFn = async (
    query: Record<string, unknown>,
  ): Promise<ListResponse<WorkflowRun>> => {
    const page = (query.page as number) || 1;
    const limit = (query.limit as number) || 10;
    const offset = (page - 1) * limit;

    const response = await api.getWorkflowRuns({
      workflowId,
      search: query.search as string | undefined,
      sortBy: toWorkflowRunsSortColumn(query.sortBy),
      sortDir: query.sortDir as "asc" | "desc" | undefined,
      limit,
      offset,
    });

    const total = response.meta?.pagination?.total ?? response.data.length;

    return {
      data: response.data,
      meta: {
        pagination: {
          total,
          page,
          limit,
          totalPages:
            response.meta?.pagination?.totalPages ??
            (Math.ceil(total / limit) || 1),
        },
      },
    };
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Execution History</h3>

      <DataTable<WorkflowRun>
        mode="server"
        columns={columns}
        fetchFn={fetchFn}
        queryKey={[
          ...queryKeys.workflowRuns.list({ workflowId }),
          "execution-logs",
        ]}
        onRowClick={(run) =>
          void navigate(`/workflows/${workflowId}/runs/${run.id}`)
        }
        emptyMessage="No execution history yet"
      />
    </div>
  );
}
