import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  WORKFLOW_EVENT_SORT_COLUMNS,
  type WorkflowEventSortColumn,
} from "@nexus/core";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { WorkflowEventRecord } from "@/lib/api/workflows.types";
import { DataTable } from "@/components/ui/data-table";
import type { ColumnDef, ListResponse } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { formatDateSafe } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface WorkflowEventsFeedProps {
  title: string;
  description: string;
  projectId?: string;
  pageSize?: number;
}

function getStringField(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toPayloadPreview(payload: Record<string, unknown> | null | undefined) {
  if (!payload || Object.keys(payload).length === 0) {
    return "-";
  }

  const summary =
    getStringField(payload, "reason") ??
    getStringField(payload, "error") ??
    getStringField(payload, "errorMessage");
  if (summary) {
    return summary.length <= 220 ? summary : `${summary.slice(0, 217)}...`;
  }

  try {
    const asJson = JSON.stringify(payload);
    if (asJson.length <= 220) {
      return asJson;
    }
    return `${asJson.slice(0, 217)}...`;
  } catch {
    return "[unserializable payload]";
  }
}

function toWorkflowEventSortColumn(
  value: unknown,
): WorkflowEventSortColumn | undefined {
  return typeof value === "string" &&
    (WORKFLOW_EVENT_SORT_COLUMNS as readonly string[]).includes(value)
    ? (value as WorkflowEventSortColumn)
    : undefined;
}

export function WorkflowEventsFeed({
  title,
  description,
  projectId,
  pageSize = 25,
}: Readonly<WorkflowEventsFeedProps>) {
  const navigate = useNavigate();
  const [openingRunId, setOpeningRunId] = useState<string | null>(null);

  const openRunDetail = async (runId: string) => {
    setOpeningRunId(runId);
    try {
      const run = await api.getWorkflowRun(runId);
      navigate(`/workflows/${run.workflow_id}/runs/${run.id}`);
    } finally {
      setOpeningRunId(null);
    }
  };

  const columns: ColumnDef<WorkflowEventRecord>[] = [
    {
      key: "timestamp",
      label: "Timestamp",
      sortable: true,
      render: (event) =>
        formatDateSafe(event.timestamp, "MMM d, yyyy HH:mm:ss", "Unknown"),
      className: "whitespace-nowrap",
    },
    {
      key: "event_type",
      label: "Event Type",
      sortable: true,
      render: (event) => <Badge variant="outline">{event.event_type}</Badge>,
    },
    {
      key: "workflow_run_id",
      label: "Run",
      render: (event) => (
        <span className="font-mono text-xs">
          {event.workflow_run_id.slice(0, 8)}...
          {openingRunId === event.workflow_run_id ? " (opening...)" : ""}
        </span>
      ),
    },
    {
      key: "step_id",
      label: "Step",
      render: (event) => (
        <span className="font-mono text-xs">{event.step_id || "-"}</span>
      ),
    },
    {
      key: "job_id",
      label: "Job",
      render: (event) => (
        <span className="font-mono text-xs">{event.job_id || "-"}</span>
      ),
    },
    {
      key: "payload",
      label: "Payload",
      render: (event) => (
        <span className="font-mono text-xs text-muted-foreground max-w-[360px] truncate block">
          {toPayloadPreview(event.payload)}
        </span>
      ),
    },
  ];

  const fetchFn = async (
    query: Record<string, unknown>,
  ): Promise<ListResponse<WorkflowEventRecord>> => {
    const page = (query.page as number) || 1;
    const limit = (query.limit as number) || pageSize;
    const offset = (page - 1) * limit;

    const response = await api.getWorkflowEvents({
      projectId,
      search: query.search as string | undefined,
      sortBy: toWorkflowEventSortColumn(query.sortBy),
      sortDir: query.sortDir as "asc" | "desc" | undefined,
      limit,
      offset,
    });

    return {
      data: response.data,
      meta: {
        pagination: {
          total: response.total,
          page,
          limit,
          totalPages: Math.ceil(response.total / limit) || 1,
        },
      },
    };
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <DataTable<WorkflowEventRecord>
          mode="server"
          columns={columns}
          fetchFn={fetchFn}
          queryKey={[
            ...queryKeys.workflowEvents.list({
              projectId,
              limit: pageSize,
              offset: 0,
            }),
            "feed",
          ]}
          onRowClick={(event) => {
            void openRunDetail(event.workflow_run_id);
          }}
          emptyMessage="No persisted workflow events found."
        />
      </CardContent>
    </Card>
  );
}
