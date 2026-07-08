import { ScheduledJob } from "@/lib/api/scheduled-jobs.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  formatScheduleDate,
  scheduleRunStatusVariant,
  scheduleStatusVariant,
} from "./SchedulesTab.helpers";
import type {
  ScheduleListCallbacks,
  SchedulesListActionState,
  SchedulesStatusFilter,
} from "./SchedulesTab.types";

interface SchedulesTabListCardProps {
  jobs: ScheduledJob[];
  isLoading: boolean;
  statusFilter: SchedulesStatusFilter;
  selectedRunsJobId: string | null;
  actionState: SchedulesListActionState;
  onStatusFilterChange: (value: SchedulesStatusFilter) => void;
  callbacks: ScheduleListCallbacks;
}

export function SchedulesTabListCard({
  jobs,
  isLoading,
  statusFilter,
  selectedRunsJobId,
  actionState,
  onStatusFilterChange,
  callbacks,
}: Readonly<SchedulesTabListCardProps>) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>Schedules</CardTitle>
        <div className="flex items-center gap-2">
          <Label htmlFor="schedule-filter">Status</Label>
          <select
            id="schedule-filter"
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            value={statusFilter}
            onChange={(event) =>
              onStatusFilterChange(
                event.target.value === "all"
                  ? "all"
                  : (event.target.value as ScheduledJob["status"]),
              )
            }
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading schedules...</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No schedules found for this project.
          </p>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{job.name}</p>
                    <Badge variant={scheduleStatusVariant(job.status)}>
                      {job.status}
                    </Badge>
                    {job.last_run ? (
                      <Badge
                        variant={scheduleRunStatusVariant(job.last_run.status)}
                      >
                        last run: {job.last_run.status}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {job.schedule_type} • {job.schedule_expression}
                    {job.timezone ? ` • ${job.timezone}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Next run: {formatScheduleDate(job.next_run_at)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => callbacks.onEdit(job)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => callbacks.onTogglePauseResume(job)}
                    disabled={
                      actionState.pausePending || actionState.resumePending
                    }
                  >
                    {job.status === "active" ? "Pause" : "Resume"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => callbacks.onRunNow(job.id)}
                    disabled={actionState.runNowPending}
                  >
                    Run Now
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => callbacks.onToggleRuns(job.id)}
                  >
                    {selectedRunsJobId === job.id ? "Hide Runs" : "Show Runs"}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => callbacks.onDelete(job.id)}
                    disabled={actionState.deletePending}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
