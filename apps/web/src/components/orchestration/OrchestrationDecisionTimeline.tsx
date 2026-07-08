import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateSafe } from "@/lib/utils";
import { ProjectOrchestrationDecisionEntry } from "@/lib/api/projects.types";

interface OrchestrationDecisionTimelineProps {
  entries: ProjectOrchestrationDecisionEntry[];
}

export function OrchestrationDecisionTimeline({
  entries,
}: Readonly<OrchestrationDecisionTimelineProps>) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Decision Log</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No decisions recorded yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decision Log</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[360px] space-y-3 overflow-auto pr-1">
          {entries
            .slice()
            .reverse()
            .map((entry, index) => (
              <div
                key={`${entry.timestamp}-${entry.type}-${index}`}
                className="rounded-md border p-3"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant="outline">{entry.type}</Badge>
                    {entry.modeEvaluation ? (
                      <Badge variant="secondary">
                        mode: {entry.modeEvaluation}
                      </Badge>
                    ) : null}
                    {entry.executionStatus ? (
                      <Badge variant="secondary">
                        status: {entry.executionStatus}
                      </Badge>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDateSafe(
                      entry.timestamp,
                      "MMM d, yyyy HH:mm:ss",
                      "Unknown",
                    )}
                  </span>
                </div>

                <p className="text-sm whitespace-pre-wrap">{entry.reasoning}</p>

                {entry.actions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {entry.actions.map((action) => (
                      <Badge key={action} variant="secondary">
                        {action}
                      </Badge>
                    ))}
                  </div>
                )}

                {entry.recommendation ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Recommendation: {entry.recommendation}
                  </p>
                ) : null}
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
