import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { useChatMemoryObservability } from "@/hooks/useMemoryExplorer";

interface ChatMemoryPipelineHealthCardProps {
  chatObservabilityQuery: ReturnType<typeof useChatMemoryObservability>;
}

export function ChatMemoryPipelineHealthCard({
  chatObservabilityQuery,
}: Readonly<ChatMemoryPipelineHealthCardProps>) {
  const observability = chatObservabilityQuery.data;

  return (
    <Card className="border-dashed">
      <CardHeader className="space-y-2 pb-4">
        <CardTitle className="text-base">Memory Pipeline Health</CardTitle>
        <p className="text-sm text-muted-foreground">
          Live job/event counters from persisted chat memory tables.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {chatObservabilityQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">
            Loading pipeline health...
          </p>
        ) : null}

        {chatObservabilityQuery.isError ? (
          <p className="text-sm text-destructive">
            Unable to load pipeline health.
          </p>
        ) : null}

        {observability ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <Badge variant="outline">
                Pending jobs {observability.counts.jobs.pending.toString()}
              </Badge>
              <Badge variant="outline">
                Running jobs {observability.counts.jobs.running.toString()}
              </Badge>
              <Badge
                variant={
                  observability.counts.jobs.failed > 0
                    ? "destructive"
                    : "outline"
                }
              >
                Failed jobs {observability.counts.jobs.failed.toString()}
              </Badge>
              <Badge variant="outline">
                Completed jobs {observability.counts.jobs.completed.toString()}
              </Badge>
              <Badge variant="outline">
                Promoted events{" "}
                {observability.counts.events.promoted.toString()}
              </Badge>
              <Badge variant="outline">
                Updated events {observability.counts.events.updated.toString()}
              </Badge>
            </div>

            {observability.recent_failed_jobs.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">
                  Recent failed jobs
                </p>
                <div className="space-y-2">
                  {observability.recent_failed_jobs.slice(0, 3).map((job) => (
                    <div
                      key={job.id}
                      className="rounded-md border border-destructive/30 bg-destructive/5 p-3"
                    >
                      <p className="text-xs font-medium">
                        {job.job_type} ({job.trigger_reason})
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Attempts {job.attempts.toString()}/
                        {job.max_attempts.toString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {job.last_error ?? "Unknown error"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No failed jobs in the recent window.
              </p>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
