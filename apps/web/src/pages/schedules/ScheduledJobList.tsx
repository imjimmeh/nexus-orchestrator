import { Card, CardContent } from "@/components/ui/card";
import { ScheduledJob } from "@/lib/api/scheduled-jobs.types";
import { ScheduledJobListItem } from "./ScheduledJobListItem";

interface ScheduledJobListProps {
  isLoading: boolean;
  jobs: ScheduledJob[];
  projectNamesById: Map<string, string>;
  onPauseResume: (job: ScheduledJob) => void;
  onRunNow: (jobId: string) => void;
  onDelete: (jobId: string) => void;
}

export function ScheduledJobList({
  isLoading,
  jobs,
  projectNamesById,
  onPauseResume,
  onRunNow,
  onDelete,
}: Readonly<ScheduledJobListProps>) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading schedules...</p>
        ) : null}

        {!isLoading && jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No schedules match the selected filters.
          </p>
        ) : null}

        {jobs.map((job) => (
          <ScheduledJobListItem
            key={job.id}
            job={job}
            projectNamesById={projectNamesById}
            onPauseResume={onPauseResume}
            onRunNow={onRunNow}
            onDelete={onDelete}
          />
        ))}
      </CardContent>
    </Card>
  );
}
