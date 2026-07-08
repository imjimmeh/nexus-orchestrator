import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WorkflowRunAutonomyDiagnostics } from "@/lib/api/workflow-lifecycle.types";

interface WorkflowAutonomyDiagnosticsPanelProps {
  diagnostics: WorkflowRunAutonomyDiagnostics;
}

export function WorkflowAutonomyDiagnosticsPanel({
  diagnostics,
}: Readonly<WorkflowAutonomyDiagnosticsPanelProps>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Autonomy Diagnostics</CardTitle>
        <CardDescription>
          Repair classification and delegation context for this workflow run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {diagnostics.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No autonomy diagnostics recorded for this run.
          </p>
        )}

        {diagnostics.items.map((item, index) => (
          <div
            key={`${item.category}-${item.title}-${index}`}
            className="rounded-md border p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{item.category}</Badge>
              <Badge>{item.status}</Badge>
              {item.occurredAt && (
                <span className="text-xs text-muted-foreground">
                  {new Date(item.occurredAt).toLocaleString()}
                </span>
              )}
            </div>
            <h3 className="mt-2 text-sm font-semibold">{item.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>

            {item.evidence.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Evidence
                </p>
                {item.evidence.map((reference, evidenceIndex) => (
                  <div
                    key={`${reference.kind}-${reference.id ?? evidenceIndex}`}
                    className="text-xs"
                  >
                    <span className="font-mono">
                      {reference.kind}
                      {reference.id ? `: ${reference.id}` : ""}
                    </span>
                    <span className="ml-1 text-muted-foreground">
                      {reference.summary}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {item.nextSteps.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Next Steps
                </p>
                {item.nextSteps.map((step) => (
                  <div
                    key={step.label}
                    className="text-xs text-muted-foreground"
                  >
                    {step.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
