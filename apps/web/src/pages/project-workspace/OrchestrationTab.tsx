import { Card, CardContent } from "@/components/ui/card";
import { QuestionAnswer } from "@/lib/api/settings.types";
import { OrchestrationControlsCard } from "./OrchestrationControlsCard";
import { OrchestrationInteractionAlerts } from "./OrchestrationInteractionAlerts";
import { OrchestrationStartDialog } from "./OrchestrationStartDialog";
import { useSteeringChat } from "@/hooks/useSteeringChat";
import { useOrchestrationTabState } from "./OrchestrationTab.state";
import { useState } from "react";
import {
  toErrorMessage,
  useOrchestrationTabActions,
} from "./OrchestrationTab.actions";
import { OrchestrationTabMainPanel } from "./OrchestrationTab.main-panel";
import { OrchestrationPolicyPanel } from "@/components/orchestration/OrchestrationPolicyPanel";

interface OrchestrationTabProps {
  projectId: string;
}

export function OrchestrationTab({
  projectId,
}: Readonly<OrchestrationTabProps>) {
  const state = useOrchestrationTabState(projectId);
  const steeringChat = useSteeringChat();
  const [steeringInput, setSteeringInput] = useState("");
  const actions = useOrchestrationTabActions(state);
  const isRunLinkMissing =
    state.orchestration?.status === "orchestrating" && !state.currentRunId;
  if (state.isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Loading orchestration state...
          </p>
        </CardContent>
      </Card>
    );
  }
  const canSubmitStart = true;

  return (
    <div className="space-y-4">
      <OrchestrationInteractionAlerts
        orchestrationStatus={state.orchestration?.status ?? null}
        notice={state.notice}
        isRunInferredByProjectOnly={state.isRunInferredByProjectOnly}
        isRunLinkMissing={isRunLinkMissing}
        pendingQuestions={state.pendingQuestions}
        currentRunId={state.currentRunId}
        hasActiveSessionLink={Boolean(state.activeSessionHref)}
        isSubmittingAnswers={state.submitAnswersMutation.isPending}
        onRecoverRunLink={() => {
          void state.refreshRunLink();
        }}
        onSubmitAnswers={(answers: QuestionAnswer[]) => {
          state.submitAnswersMutation.mutate(answers);
        }}
      />
      <OrchestrationControlsCard
        orchestration={state.orchestration}
        workflowRun={state.workflowRun}
        currentRunId={state.currentRunId}
        pendingQuestionCount={state.pendingQuestions?.length ?? 0}
        pendingActionCount={state.pendingActionRequests.length}
        activeSessionHref={state.activeSessionHref}
        steeringActive={steeringChat.isActive}
        onSteerProject={() => {
          steeringChat.startSteering(projectId);
        }}
        onCloseSteering={() => {
          steeringChat.closeSteering();
        }}
        onOpenStartDialog={() => {
          state.setStartDialogOpen(true);
        }}
        onPause={() => {
          actions.handleAction(
            () => state.pauseMutation.mutateAsync(),
            "Orchestration paused.",
          );
        }}
        onResume={() => {
          actions.handleAction(
            () => state.resumeMutation.mutateAsync(),
            "Orchestration resumed.",
          );
        }}
        onRecoverImportedHydration={() => {
          actions.handleRecoverImportedHydration();
        }}
        onAbort={() => {
          actions.handleAction(
            () => state.abortRunMutation.mutateAsync(),
            "Active workflow run aborted.",
          );
        }}
        onComplete={actions.handleComplete}
        onResetBlockedIntents={() => {
          void actions.handleAction(
            () => state.resetIntentsMutation.mutateAsync(),
            "Blocked intents reset.",
          );
        }}
        isAbortPending={state.abortRunMutation.isPending}
        isCompletePending={actions.isCompletePending}
        isRecoverImportedHydrationPending={
          state.recoverImportedHydrationMutation.isPending
        }
        isResetIntentsPending={state.resetIntentsMutation.isPending}
        canRecoverImportedHydration={state.canRecoverImportedHydration}
        onModeChange={actions.handleModeChange}
      />
      <OrchestrationTabMainPanel
        projectId={projectId}
        state={state}
        steeringChat={steeringChat}
        steeringInput={steeringInput}
        onSteeringInputChange={setSteeringInput}
        onSteeringInputClear={() => {
          setSteeringInput("");
        }}
        handleAction={actions.handleAction}
        toErrorMessage={toErrorMessage}
      />

      <OrchestrationStartDialog
        open={state.startDialogOpen}
        onOpenChange={state.setStartDialogOpen}
        orchestrationStatus={state.orchestration?.status ?? null}
        mode={state.mode}
        onModeChange={state.setMode}
        onSubmit={actions.handleStart}
        isSubmitting={state.startMutation.isPending}
        canSubmit={canSubmitStart}
      />
      <OrchestrationPolicyPanel projectId={projectId} />
    </div>
  );
}
