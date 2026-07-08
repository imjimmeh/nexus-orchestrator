import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatLearningDateTime,
  formatLearningPercent,
} from "./LearningTab.helpers";
import type { LearningTabStatusCardProps } from "./LearningTab.types";

interface StatusMetricProps {
  label: string;
  value: string;
}

function StatusMetric({ label, value }: Readonly<StatusMetricProps>) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}

export function LearningTabStatusCard({
  status,
  isLoading,
  isRunningSweep,
  onRunSweep,
}: Readonly<LearningTabStatusCardProps>) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Autonomous Learning</CardTitle>
          <Button onClick={onRunSweep} disabled={isRunningSweep}>
            {isRunningSweep ? "Running..." : "Run Sweep Now"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading && !status ? (
          <p className="text-sm text-muted-foreground">Loading status...</p>
        ) : null}

        {status ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status.enabled ? "default" : "outline"}>
                {status.enabled ? "Enabled" : "Disabled"}
              </Badge>
              <Badge variant="outline">
                Interval {status.intervalSeconds.toString()}s
              </Badge>
              <Badge variant="outline">
                Promote {formatLearningPercent(status.promotionThreshold)}
              </Badge>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <StatusMetric
                label="Pending Candidates"
                value={status.candidateTotals.pending.toString()}
              />
              <StatusMetric
                label="Promoted Candidates"
                value={status.candidateTotals.promoted.toString()}
              />
            </div>

            {status.lastRun ? (
              <div className="rounded-md border p-3">
                <p className="text-sm font-semibold">Last Sweep</p>
                <p className="text-xs text-muted-foreground">
                  Completed {formatLearningDateTime(status.lastRun.completedAt)}
                </p>
                <div className="mt-2 grid gap-2 text-xs text-muted-foreground md:grid-cols-2 lg:grid-cols-3">
                  <p>Run ID: {status.lastRun.runId}</p>
                  <p>Trigger: {status.lastRun.trigger}</p>
                  <p>Scopes: {status.lastRun.scannedScopes.toString()}</p>
                  <p>
                    Observations:{" "}
                    {status.lastRun.scannedObservations.toString()}
                  </p>
                  <p>
                    Ranked candidates:{" "}
                    {status.lastRun.rankedCandidates.toString()}
                  </p>
                  <p>
                    New promotions:{" "}
                    {status.lastRun.promotedCandidates.toString()}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No memory-learning sweep has run yet.
              </p>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
