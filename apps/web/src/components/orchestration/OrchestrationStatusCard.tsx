import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProjectOrchestration, ProjectStateSnapshot } from "@/lib/api/projects.types";
import { WorkflowRun, WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { RunContextPanel } from "./orchestration-run-context-panel";
import { ProcessPhasesPanel } from "./orchestration-process-phases-panel";
import { ProjectStatsPanel } from "./orchestration-project-stats-panel";

const RUN_PENDING_EVENT_TYPES = new Set(["workflow.started", "job.queued"]);
const WAITING_SIGNAL_MS = 90_000;

type RunSummarySeverity = "info" | "warning" | "error";

function getStatusVariant(status: ProjectOrchestration["status"]) {
  if (status === "failed") {
    return "destructive" as const;
  }

  if (status === "completed") {
    return "secondary" as const;
  }

  if (
    status === "initializing" ||
    status === "awaiting_approval" ||
    status === "bootstrapping" ||
    status === "orchestrating"
  ) {
    return "default" as const;
  }

  return "outline" as const;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "unknown";
  }

  return parsed.toLocaleString();
}

function getLatestWorkflowEvent(
  workflowEvents: WorkflowTelemetryEvent[],
): WorkflowTelemetryEvent | undefined {
  return [...workflowEvents].sort(
    (left, right) =>
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
  )[0];
}

function summarizeNonRunningRun(
  status: WorkflowRun["status"],
  latestEvent: WorkflowTelemetryEvent | undefined,
): {
  title: string;
  detail: string;
  severity: RunSummarySeverity;
} {
  return {
    title: `Run status: ${status}`,
    detail: latestEvent
      ? `Latest event: ${latestEvent.event_type} at ${formatDateTime(latestEvent.timestamp)}.`
      : "No run events have been recorded yet.",
    severity: "info",
  };
}

function summarizeRunningRun(latestEvent: WorkflowTelemetryEvent | undefined): {
  title: string;
  detail: string;
  severity: RunSummarySeverity;
} {
  if (!latestEvent) {
    return {
      title: "Run is active",
      detail:
        "The workflow run is running, but no telemetry events are available yet.",
      severity: "warning",
    };
  }

  const latestEventAtMs = new Date(latestEvent.timestamp).getTime();
  const elapsedMs = Number.isFinite(latestEventAtMs)
    ? Date.now() - latestEventAtMs
    : 0;

  if (
    RUN_PENDING_EVENT_TYPES.has(latestEvent.event_type) &&
    elapsedMs > WAITING_SIGNAL_MS
  ) {
    return {
      title: "Run appears to be waiting",
      detail:
        "No progress events have arrived recently. This commonly indicates discovery is waiting for user input.",
      severity: "warning",
    };
  }

  return {
    title: "Run is making progress",
    detail: `Latest event: ${latestEvent.event_type} at ${formatDateTime(latestEvent.timestamp)}.`,
    severity: "info",
  };
}

function summarizeRunState(params: {
  orchestration: ProjectOrchestration;
  workflowRun?: WorkflowRun | null;
  workflowEvents: WorkflowTelemetryEvent[];
  hasPendingQuestions: boolean;
}): {
  title: string;
  detail: string;
  severity: RunSummarySeverity;
} {
  const { orchestration, workflowRun, workflowEvents, hasPendingQuestions } =
    params;
  const effectiveRunId = workflowRun?.id ?? orchestration.currentWorkflowRunId;
  const latestEvent = getLatestWorkflowEvent(workflowEvents);

  if (!effectiveRunId) {
    return {
      title: "No active workflow run",
      detail: "Orchestration has no linked workflow run yet.",
      severity: "info",
    };
  }

  if (!workflowRun) {
    return {
      title: "Loading run visibility",
      detail: `Fetching run ${effectiveRunId} details...`,
      severity: "info",
    };
  }

  if (hasPendingQuestions) {
    return {
      title: "Agent is waiting for your input",
      detail:
        "Pending questions are blocking progress. Answer them from this orchestration page or open the active session.",
      severity: "warning",
    };
  }

  if (workflowRun.status === "FAILED") {
    return {
      title: "Active run failed",
      detail:
        "The most recent orchestration workflow run failed. Review run events below for the failure point.",
      severity: "error",
    };
  }

  if (workflowRun.status !== "RUNNING") {
    return summarizeNonRunningRun(workflowRun.status, latestEvent);
  }

  return summarizeRunningRun(latestEvent);
}

function runSummaryClassName(severity: RunSummarySeverity): string {
  switch (severity) {
    case "error":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "warning":
      return "border-amber-300 bg-amber-50 text-amber-900";
    default:
      return "border-info/30 bg-info/10 text-info-foreground";
  }
}

interface OrchestrationStatusCardProps {
  orchestration: ProjectOrchestration;
  projectState: ProjectStateSnapshot;
  workflowRun?: WorkflowRun | null;
  workflowEvents?: WorkflowTelemetryEvent[];
  activeSessionHref?: string | null;
  hasPendingQuestions?: boolean;
  isRunCorrelationInferred?: boolean;
}

export function OrchestrationStatusCard({
  orchestration,
  projectState,
  workflowRun,
  workflowEvents = [],
  activeSessionHref = null,
  hasPendingQuestions = false,
  isRunCorrelationInferred = false,
}: Readonly<OrchestrationStatusCardProps>) {
  const effectiveRunId = workflowRun?.id ?? orchestration.currentWorkflowRunId;

  const runSummary = summarizeRunState({
    orchestration,
    workflowRun,
    workflowEvents,
    hasPendingQuestions,
  });

  const latestEvent = getLatestWorkflowEvent(workflowEvents);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Orchestration Status
          <Badge variant={getStatusVariant(orchestration.status)}>
            {orchestration.status}
          </Badge>
          <Badge variant="outline">
            Mode: {orchestration.orchestrationMode}
          </Badge>
        </CardTitle>
        <CardDescription>
          Current run: {effectiveRunId ?? "No active run"}
          {isRunCorrelationInferred && (
            <span className="block text-amber-700">
              Run linkage was inferred from project context.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {orchestration.goals || "No goals provided yet."}
        </p>

        <div
          className={`rounded-md border p-3 text-sm ${runSummaryClassName(runSummary.severity)}`}
        >
          <p className="font-medium">{runSummary.title}</p>
          <p className="mt-1 text-xs opacity-90">{runSummary.detail}</p>
        </div>

        <RunContextPanel
          effectiveRunId={effectiveRunId}
          activeSessionHref={activeSessionHref}
          workflowRun={workflowRun}
        />

        <div className="rounded-md border p-3">
          <p className="text-xs font-medium text-muted-foreground">
            Latest Workflow Event
          </p>
          {latestEvent ? (
            <p className="mt-1 text-sm">
              {latestEvent.event_type} at{" "}
              {formatDateTime(latestEvent.timestamp)}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No workflow events yet.
            </p>
          )}
        </div>

        <ProcessPhasesPanel status={orchestration.status} />

        <ProjectStatsPanel projectState={projectState} />

        {orchestration.strategySummary && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Strategy Summary
            </p>
            <p className="text-sm whitespace-pre-wrap">
              {orchestration.strategySummary}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
