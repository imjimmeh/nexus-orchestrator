import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type {
  ColumnDef,
  FilterDef,
  ListResponse,
} from "@/components/ui/data-table";
import { api } from "@/lib/api/client";
import { EventLedgerRecord } from "@/lib/api/event-ledger.types";
import { formatDateSafe } from "@/lib/utils";

const OUTCOME_FILTER: FilterDef = {
  key: "outcome",
  label: "Outcome",
  type: "select",
  options: [
    { label: "Success", value: "success" },
    { label: "Failure", value: "failure" },
    { label: "Denied", value: "denied" },
    { label: "In Progress", value: "in_progress" },
  ],
};

const SEVERITY_FILTER: FilterDef = {
  key: "severity",
  label: "Severity",
  type: "select",
  options: [
    { label: "Info", value: "info" },
    { label: "Warn", value: "warn" },
    { label: "Error", value: "error" },
    { label: "Critical", value: "critical" },
  ],
};

interface EventLedgerFeedProps {
  title: string;
  description: string;
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
    return asJson.length <= 220 ? asJson : `${asJson.slice(0, 217)}...`;
  } catch {
    return "[unserializable payload]";
  }
}

export function EventLedgerFeed({
  title,
  description,
  pageSize = 25,
}: Readonly<EventLedgerFeedProps>) {
  const columns: ColumnDef<EventLedgerRecord>[] = [
    {
      key: "occurred_at",
      label: "Timestamp",
      sortable: true,
      render: (event) =>
        formatDateSafe(event.occurred_at, "MMM d, yyyy HH:mm:ss", "Unknown"),
      className: "whitespace-nowrap",
    },
    {
      key: "domain",
      label: "Domain",
      sortable: true,
      render: (event) => <Badge variant="outline">{event.domain}</Badge>,
    },
    {
      key: "event_name",
      label: "Event",
      render: (event) => (
        <span className="font-mono text-xs">{event.event_name}</span>
      ),
    },
    {
      key: "outcome",
      label: "Outcome",
      sortable: true,
      render: (event) => <Badge variant="secondary">{event.outcome}</Badge>,
    },
    {
      key: "severity",
      label: "Severity",
      sortable: true,
      render: (event) => <Badge variant="outline">{event.severity}</Badge>,
    },
    {
      key: "source",
      label: "Source",
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
  ): Promise<ListResponse<EventLedgerRecord>> => {
    const page = (query.page as number) || 1;
    const limit = (query.limit as number) || pageSize;
    const offset = (page - 1) * limit;

    const response = await api.getEventLedger({
      outcome: query.outcome as EventLedgerRecord["outcome"] | undefined,
      severity: query.severity as EventLedgerRecord["severity"] | undefined,
      search: query.search as string | undefined,
      sortBy: query.sortBy as string | undefined,
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
        <DataTable<EventLedgerRecord>
          mode="server"
          columns={columns}
          filters={[OUTCOME_FILTER, SEVERITY_FILTER]}
          fetchFn={fetchFn}
          queryKey={["event-ledger", "feed"]}
          emptyMessage="No event ledger entries found."
        />
      </CardContent>
    </Card>
  );
}
