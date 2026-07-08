import { Card, CardContent } from "@/components/ui/card";
import { QuestionCard } from "@/components/chat/QuestionCard";
import { BudgetStatusBanner, type BudgetDecision } from "@/components/budget/BudgetStatusBanner";
import { WorkflowAutonomyDiagnosticsPanel } from "@/components/workflow/WorkflowAutonomyDiagnosticsPanel";
import { WorkflowRunRetrospectiveTraceCard } from "./WorkflowRunRetrospectiveTraceCard";
import { getWorkflowRateLimitRetryMetadata, WorkflowRateLimitRetryCard } from "./WorkflowRunDetailSupport";
import { QuestionAnswer, UserQuestion } from "@/lib/api/settings.types";
import { WorkflowRunAutonomyDiagnostics, WorkflowRunRetrospectiveTrace } from "@/lib/api/workflow-lifecycle.types";
import { WorkflowRun, WorkflowTelemetryEvent } from "@/lib/api/workflows.types";

export type WorkflowRunDiagnosticsStripProps = {
  run: WorkflowRun;
  events: WorkflowTelemetryEvent[];
  failureReason?: string;
  workItemRestartNotice?: string | null;
  telemetryError?: unknown;
  autonomyDiagnostics?: WorkflowRunAutonomyDiagnostics;
  retrospectiveTrace?: WorkflowRunRetrospectiveTrace;
  budgetDecision?: BudgetDecision | null;
  budgetReasonCode?: string | null;
  budgetEstimatedCostCents?: number | null;
  budgetRemainingCents?: number | null;
  pendingQuestions: UserQuestion[] | null;
  onSubmitAnswers: (answers: QuestionAnswer[]) => void;
  isSubmittingAnswers: boolean;
};

export function WorkflowRunDiagnosticsStrip({
  run,
  events,
  failureReason,
  workItemRestartNotice,
  telemetryError,
  autonomyDiagnostics,
  retrospectiveTrace,
  budgetDecision,
  budgetReasonCode,
  budgetEstimatedCostCents,
  budgetRemainingCents,
  pendingQuestions,
  onSubmitAnswers,
  isSubmittingAnswers,
}: Readonly<WorkflowRunDiagnosticsStripProps>) {
  const rateLimitRetryMetadata = getWorkflowRateLimitRetryMetadata(run, events);
  const showFailureReason =
    run.status === "FAILED" &&
    Boolean(failureReason) &&
    !rateLimitRetryMetadata;

  return (
    <>
      {showFailureReason && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            Failure reason: {failureReason}
          </CardContent>
        </Card>
      )}

      {workItemRestartNotice && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {workItemRestartNotice}
          </CardContent>
        </Card>
      )}

      <WorkflowRateLimitRetryCard metadata={rateLimitRetryMetadata} />

      {autonomyDiagnostics && (
        <WorkflowAutonomyDiagnosticsPanel diagnostics={autonomyDiagnostics} />
      )}

      <WorkflowRunRetrospectiveTraceCard trace={retrospectiveTrace} />

      {Boolean(telemetryError) && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            Failed to connect to live telemetry stream.
          </CardContent>
        </Card>
      )}

      {budgetDecision ? (
        <BudgetStatusBanner
          decision={budgetDecision}
          reasonCode={budgetReasonCode}
          estimatedCostCents={budgetEstimatedCostCents}
          remainingBudgetCents={budgetRemainingCents}
        />
      ) : null}

      {pendingQuestions && pendingQuestions.length > 0 && (
        <QuestionCard
          questions={pendingQuestions}
          onSubmit={onSubmitAnswers}
          submitting={isSubmittingAnswers}
        />
      )}
    </>
  );
}
