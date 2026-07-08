import { WorkflowRun } from "@/lib/api/workflows.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw } from "lucide-react";

export interface RecentRunsCardProps {
  readonly discoveryError: string | null;
  readonly isLoading: boolean;
  readonly onRefreshDiscovery: () => void;
  readonly onRunClick: (run: WorkflowRun) => void;
  readonly refreshingDiscovery: boolean;
  readonly repositoryRootPath: string | null;
  readonly runs: WorkflowRun[];
}

function getTriggerSource(run: WorkflowRun): string {
  const trigger = run.state_variables?.trigger;
  if (!trigger || typeof trigger !== "object") {
    return "-";
  }

  const source = (trigger as Record<string, unknown>).source;
  return typeof source === "string" && source.trim().length > 0 ? source : "-";
}

function formatTimestamp(value?: string | null): string {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function RecentRunsTable({
  isLoading,
  onRunClick,
  runs,
}: Pick<RecentRunsCardProps, "isLoading" | "onRunClick" | "runs">) {
  if (isLoading) {
    return <p className="text-muted-foreground text-center py-8">Loading...</p>;
  }

  if (runs.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-8">
        No repository workflow runs yet
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Workflow</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Trigger</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Completed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow
            key={run.id}
            className="cursor-pointer"
            onClick={() => onRunClick(run)}
          >
            <TableCell>{run.workflow_name ?? run.workflow_id}</TableCell>
            <TableCell>
              <Badge variant="outline">{run.status}</Badge>
            </TableCell>
            <TableCell>{getTriggerSource(run)}</TableCell>
            <TableCell>{formatTimestamp(run.created_at)}</TableCell>
            <TableCell>{formatTimestamp(run.completed_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function RecentRunsCard({
  discoveryError,
  isLoading,
  onRefreshDiscovery,
  onRunClick,
  refreshingDiscovery,
  repositoryRootPath,
  runs,
}: RecentRunsCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Recent Runs</CardTitle>
          {!repositoryRootPath ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Repository root path is required to refresh discovery.
            </p>
          ) : null}
          {discoveryError ? (
            <p className="mt-2 text-xs text-destructive">{discoveryError}</p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefreshDiscovery}
          disabled={!repositoryRootPath || refreshingDiscovery}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${refreshingDiscovery ? "animate-spin" : ""}`}
          />
          Refresh discovery
        </Button>
      </CardHeader>
      <CardContent>
        <RecentRunsTable
          isLoading={isLoading}
          onRunClick={onRunClick}
          runs={runs}
        />
      </CardContent>
    </Card>
  );
}
