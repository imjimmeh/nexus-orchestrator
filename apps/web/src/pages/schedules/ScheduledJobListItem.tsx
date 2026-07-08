import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScheduledJob } from "@/lib/api/scheduled-jobs.types";
import {
  formatScheduleDate,
  scheduleStatusVariant,
} from "../project-workspace/SchedulesTab.helpers";

function resolveProjectName(params: {
  projectId: string | null;
  projectNamesById: Map<string, string>;
}): string {
  if (!params.projectId) {
    return "Global";
  }

  return params.projectNamesById.get(params.projectId) ?? params.projectId;
}

interface ScheduledJobListItemProps {
  job: ScheduledJob;
  projectNamesById: Map<string, string>;
  onPauseResume: (job: ScheduledJob) => void;
  onRunNow: (jobId: string) => void;
  onDelete: (jobId: string) => void;
}

export function ScheduledJobListItem({
  job,
  projectNamesById,
  onPauseResume,
  onRunNow,
  onDelete,
}: Readonly<ScheduledJobListItemProps>) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{job.name}</p>
            <Badge variant={scheduleStatusVariant(job.status)}>
              {job.status}
            </Badge>
            <Badge variant="outline">{job.schedule_scope}</Badge>
          </div>

          <p className="text-xs text-muted-foreground">
            {job.schedule_type} • {job.schedule_expression}
            {job.timezone ? ` • ${job.timezone}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Project:{" "}
            {resolveProjectName({
              projectId: job.scopeId,
              projectNamesById,
            })}
            {job.scopeId ? (
              <>
                {" "}
                •{" "}
                <Link
                  className="underline"
                  to={`/projects/${job.scopeId}?tab=schedules`}
                >
                  open project schedules
                </Link>
              </>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">
            Next run: {formatScheduleDate(job.next_run_at)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onPauseResume(job);
            }}
          >
            {job.status === "active" ? "Pause" : "Resume"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onRunNow(job.id);
            }}
          >
            Run Now
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onDelete(job.id);
            }}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
