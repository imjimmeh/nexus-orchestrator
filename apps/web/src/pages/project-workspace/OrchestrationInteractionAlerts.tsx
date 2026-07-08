import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { QuestionCard } from "@/components/chat/QuestionCard";
import { QuestionAnswer, UserQuestion } from "@/lib/api/settings.types";
import type { NoticeState } from "./OrchestrationTab.types";

interface OrchestrationInteractionAlertsProps {
  orchestrationStatus: string | null;
  notice: NoticeState | null;
  isRunInferredByProjectOnly: boolean;
  isRunLinkMissing: boolean;
  pendingQuestions: UserQuestion[] | null;
  currentRunId: string | null;
  hasActiveSessionLink: boolean;
  isSubmittingAnswers: boolean;
  onRecoverRunLink: () => void;
  onSubmitAnswers: (answers: QuestionAnswer[]) => void;
}

export function OrchestrationInteractionAlerts({
  orchestrationStatus,
  notice,
  isRunInferredByProjectOnly,
  isRunLinkMissing,
  pendingQuestions,
  currentRunId,
  hasActiveSessionLink,
  isSubmittingAnswers,
  onRecoverRunLink,
  onSubmitAnswers,
}: Readonly<OrchestrationInteractionAlertsProps>) {
  return (
    <>
      {orchestrationStatus === "failed" && (
        <Alert variant="destructive">
          <AlertTitle>Orchestration Failed</AlertTitle>
          <AlertDescription>
            The orchestration workflow failed. Click <strong>Restart</strong> to
            retry with the same or updated goals.
          </AlertDescription>
        </Alert>
      )}

      {notice && (
        <Alert variant={notice.type === "error" ? "destructive" : "default"}>
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      )}

      {isRunInferredByProjectOnly && (
        <Alert>
          <AlertTitle>Run Linkage Is Inferred</AlertTitle>
          <AlertDescription>
            The active run is inferred by project context because the
            orchestration link is missing. Verify this run before taking action.
          </AlertDescription>
        </Alert>
      )}

      {isRunLinkMissing && (
        <Alert variant="destructive">
          <AlertTitle>No Active Workflow Run Linked</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Orchestration is marked as running, but no workflow run is linked
              right now. Run controls like abort cannot target a run until the
              linkage is restored.
            </p>
            <Button variant="outline" size="sm" onClick={onRecoverRunLink}>
              Refresh Run Link
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {pendingQuestions && pendingQuestions.length > 0 && currentRunId && (
        <div className="space-y-2">
          {!hasActiveSessionLink && (
            <Alert>
              <AlertTitle>Session Workspace Is Not Linked Yet</AlertTitle>
              <AlertDescription>
                You can still answer the agent questions below. A work-item or
                run-scoped active session link is not available for this run
                yet.
              </AlertDescription>
            </Alert>
          )}
          <QuestionCard
            questions={pendingQuestions}
            onSubmit={onSubmitAnswers}
            submitting={isSubmittingAnswers}
          />
        </div>
      )}
    </>
  );
}
