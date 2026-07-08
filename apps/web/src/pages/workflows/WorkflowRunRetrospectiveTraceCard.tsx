import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkflowRunRetrospectiveTrace } from "@/lib/api/workflow-lifecycle.types";

type WorkflowRunRetrospectiveTraceCardProps = {
  trace?: WorkflowRunRetrospectiveTrace;
};

export function WorkflowRunRetrospectiveTraceCard({
  trace,
}: Readonly<WorkflowRunRetrospectiveTraceCardProps>) {
  if (!trace || trace.findingsTotal === 0) {
    return null;
  }

  const outcomes = Object.entries(trace.outcomes);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retrospective learning trace</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {trace.findingsTotal} findings observed
          </Badge>
          {outcomes.map(([outcome, count]) => (
            <Badge key={outcome} variant="outline">
              {outcome}: {count}
            </Badge>
          ))}
        </div>
        <div className="space-y-2">
          {trace.findings.map((finding) => (
            <div
              key={finding.index}
              className="rounded-md border bg-muted/30 px-3 py-2"
            >
              <div className="font-medium">
                #{finding.index} {finding.outcome ?? "received"}
              </div>
              {finding.reasonCode ? (
                <div className="text-muted-foreground">
                  Reason: {finding.reasonCode}
                </div>
              ) : null}
              {finding.candidateId ? (
                <div className="text-muted-foreground">
                  Candidate: {finding.candidateId}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
