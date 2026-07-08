import { Badge } from "@/components/ui/badge";
import { HeartbeatRun } from "@/lib/api/projects.types";
import {
  formatScheduleDate,
  scheduleRunStatusVariant,
} from "./SchedulesTab.helpers";

interface HeartbeatRunsHistoryProps {
  readonly selectedProfileId: string | null;
  readonly runs: HeartbeatRun[];
  readonly isLoading: boolean;
}

function HeartbeatRunsHistory({
  selectedProfileId,
  runs,
  isLoading,
}: Readonly<HeartbeatRunsHistoryProps>) {
  if (!selectedProfileId) {
    return null;
  }

  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">Heartbeat Run History</p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading runs...</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <div
              key={run.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={scheduleRunStatusVariant(run.status)}>
                    {run.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    due {formatScheduleDate(run.due_at)}
                  </span>
                </div>
                {run.error_message ? (
                  <p className="text-xs text-destructive">{run.error_message}</p>
                ) : null}
              </div>

              <span className="text-xs text-muted-foreground">
                workflow run: {run.workflow_run_id ?? "-"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { HeartbeatRunsHistory };
export type { HeartbeatRunsHistoryProps };
