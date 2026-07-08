import { SteeringChatPanel } from "@/components/chat/SteeringChatPanel";
import { useSteeringChat } from "@/hooks/useSteeringChat";
import { runWithNotice } from "./OrchestrationTab.helpers";
import { OrchestrationDetailsSection } from "./OrchestrationDetailsSection";
import { useOrchestrationTabState } from "./OrchestrationTab.state";

interface OrchestrationTabMainPanelProps {
  projectId: string;
  state: ReturnType<typeof useOrchestrationTabState>;
  steeringChat: ReturnType<typeof useSteeringChat>;
  steeringInput: string;
  onSteeringInputChange: (value: string) => void;
  onSteeringInputClear: () => void;
  handleAction: (
    runner: () => Promise<unknown>,
    successMessage: string,
  ) => Promise<void>;
  toErrorMessage: (error: unknown) => string;
}

export function OrchestrationTabMainPanel({
  projectId,
  state,
  steeringChat,
  steeringInput,
  onSteeringInputChange,
  onSteeringInputClear,
  handleAction,
  toErrorMessage,
}: Readonly<OrchestrationTabMainPanelProps>) {
  if (steeringChat.isActive) {
    return (
      <SteeringChatPanel
        messages={steeringChat.messages}
        input={steeringInput}
        onInputChange={onSteeringInputChange}
        onSend={() => {
          steeringChat.sendSteeringMessage(steeringInput);
          onSteeringInputClear();
        }}
        sending={steeringChat.isLoading}
        onApprovePlan={steeringChat.approvePlan}
        onRejectPlan={steeringChat.rejectPlan}
        onModifyPlan={steeringChat.modifyPlan}
        errorMessage={steeringChat.error}
        onDismissError={() =>
          steeringChat.clearError?.() ?? steeringChat.closeSteering()
        }
      />
    );
  }

  return (
    <OrchestrationDetailsSection
      projectId={projectId}
      currentRunId={state.currentRunId}
      orchestration={state.orchestration}
      projectState={state.projectState}
      workflowRun={state.workflowRun}
      workflowRunEvents={state.workflowRunEvents}
      diagnostics={state.orchestrationDiagnostics}
      capabilities={state.runtimeCapabilities}
      diagnosticsLoading={state.isDiagnosticsLoading}
      capabilitiesLoading={state.isCapabilitiesLoading}
      diagnosticsError={
        state.diagnosticsError ? toErrorMessage(state.diagnosticsError) : null
      }
      capabilitiesError={
        state.capabilitiesError ? toErrorMessage(state.capabilitiesError) : null
      }
      activeSessionHref={state.activeSessionHref}
      hasPendingQuestions={Boolean(state.pendingQuestions?.length)}
      isRunCorrelationInferred={state.isRunInferredByProjectOnly}
      pendingActionRequests={state.pendingActionRequests}
      notifications={state.notifications}
      onApproveActionRequest={async (actionRequestId: string) => {
        await handleAction(
          () => state.approveActionMutation.mutateAsync({ actionRequestId }),
          "Pending action approved and executed.",
        );
      }}
      onRejectActionRequest={async (params) => {
        await handleAction(
          () => state.rejectActionMutation.mutateAsync(params),
          "Pending action rejected.",
        );
      }}
      isActionMutationPending={
        state.approveActionMutation.isPending ||
        state.rejectActionMutation.isPending
      }
      onReplayRetrospective={async (mode) => {
        await runWithNotice({
          runner: () => state.replayRetrospectiveMutation.mutateAsync({ mode }),
          setNotice: state.setNotice,
          successTitle: "Retrospective Replayed",
          successMessage:
            "Retrospective replay completed and diagnostics were refreshed.",
          errorTitle: "Retrospective Replay Failed",
        });
      }}
      isReplayRetrospectivePending={state.replayRetrospectiveMutation.isPending}
    />
  );
}
