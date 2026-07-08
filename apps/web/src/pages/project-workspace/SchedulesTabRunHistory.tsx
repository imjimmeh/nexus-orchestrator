import { ScheduledJobRunsListResponse } from "@/lib/api/scheduled-jobs.types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatScheduleDate,
  scheduleRunStatusVariant,
} from "./SchedulesTab.helpers";

interface SchedulesTabRunHistoryProps {
  selectedRunsJobId: string | null;
  isLoading: boolean;
  runs: ScheduledJobRunsListResponse | undefined;
}

export function SchedulesTabRunHistory({
  selectedRunsJobId,
  isLoading,
  runs,
}: Readonly<SchedulesTabRunHistoryProps>) {
  if (!selectedRunsJobId) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run History</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            Loading run history...
          </p>
        ) : (runs?.items?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          runs?.items.map((run) => (
            <div key={run.id} className="rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Badge variant={scheduleRunStatusVariant(run.status)}>
                  {run.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Triggered: {formatScheduleDate(run.triggered_at)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Workflow run: {run.workflow_run_id ?? "not started"}
              </p>
              {run.error_message ? (
                <p className="mt-1 text-xs text-destructive">
                  {run.error_message}
                </p>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
