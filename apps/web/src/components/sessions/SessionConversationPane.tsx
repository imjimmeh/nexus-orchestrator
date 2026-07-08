import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SessionConversationPaneHeader } from "./SessionConversationPaneHeader";
import { SessionWorkflowDetailsCard } from "./SessionWorkflowDetailsCard";
import { useSessionConversationPaneData } from "./SessionConversationPane.data";
import { useSessionConversationPaneActions } from "./SessionConversationPane.actions";
import { SessionConversationPaneAlerts } from "./SessionConversationPaneAlerts";
import { SessionConversationPaneConversation } from "./SessionConversationPaneConversation";

interface SessionConversationPaneProps {
  threadId: string;
  kind: "chat" | "workflow" | "subagent";
  onShowExecution: () => void;
  onMarkAsRead: () => void;
}

type BudgetDecisionLike =
  | "allow"
  | "warn"
  | "approval_required"
  | "throttle"
  | "deny";

interface BudgetSnapshot {
  decision: BudgetDecisionLike | null;
  reasonCode: string | null;
  estimatedCostCents: number | null;
  remainingBudgetCents: number | null;
}

const EMPTY_BUDGET: BudgetSnapshot = {
  decision: null,
  reasonCode: null,
  estimatedCostCents: null,
  remainingBudgetCents: null,
};

interface RawBudgetDecision {
  decision?: BudgetDecisionLike | null;
  reasonCode?: string | null;
  estimatedCostCents?: number | null;
  remainingBudgetCents?: number | null;
}

function readBudgetDecision(data: ReturnType<
  typeof useSessionConversationPaneData
>): BudgetSnapshot {
  const budget = data.isChatSession
    ? data.chatSession.data?.latestBudgetDecision
    : data.workflowRun.data?.latestBudgetDecision;
  if (!budget) {
    return EMPTY_BUDGET;
  }
  const raw = budget as RawBudgetDecision;
  return {
    decision: raw.decision ?? null,
    reasonCode: raw.reasonCode ?? null,
    estimatedCostCents: raw.estimatedCostCents ?? null,
    remainingBudgetCents: raw.remainingBudgetCents ?? null,
  };
}

export function SessionConversationPane({
  threadId,
  kind,
  onShowExecution,
  onMarkAsRead,
}: Readonly<SessionConversationPaneProps>) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const data = useSessionConversationPaneData({ threadId, kind });
  const actions = useSessionConversationPaneActions({
    threadId,
    isChatSession: data.isChatSession,
    isWorkflowRun: data.isWorkflowRun,
    projectId: data.projectId,
    message,
    setMessage,
    pendingQuestions: data.pendingQuestions,
    queryClient,
  });

  // Mark as read on mount/thread change
  useEffect(() => {
    onMarkAsRead();
  }, [threadId, onMarkAsRead]);

  if (data.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Loading conversation...</p>
      </div>
    );
  }

  const budget = readBudgetDecision(data);
  const showWorkflowDetails = !data.isChatSession;

  return (
    <div className="flex flex-col h-full">
      <SessionConversationPaneHeader
        title={data.title}
        status={data.status}
        connectionState={data.connectionState}
        isChatSession={data.isChatSession}
        projectName={data.chatSession.data?.projectName}
        workflowId={data.workflowRun.data?.workflow_id}
        workflowRunId={data.workflowRun.data?.id}
        canAbortWorkflowRun={data.canAbortWorkflowRun}
        onAbort={actions.actionState.onAbort}
        isAbortPending={actions.actionState.abortMutation?.isPending ?? false}
        onShowExecution={onShowExecution}
      />

      <SessionConversationPaneAlerts
        connectionError={data.chatTelemetry.error}
        isWaitingOnRateLimit={data.isWaitingOnRateLimit}
        retryMetadata={data.retryMetadata ?? undefined}
        runtimeNotice={data.runtimeNotice}
        onRetryNow={() => actions.retryChatSessionNow.mutate()}
        isRetryPending={actions.retryChatSessionNow.isPending}
        budgetDecision={budget.decision}
        budgetReasonCode={budget.reasonCode}
        budgetEstimatedCostCents={budget.estimatedCostCents}
        budgetRemainingCents={budget.remainingBudgetCents}
      />

      <SessionConversationPaneConversation
        agentTodos={data.agentTodos}
        messages={data.chatMessages}
        message={message}
        onMessageChange={setMessage}
        onSend={actions.handleSend}
        isSendingInject={actions.actionState.injectMutation.isPending}
        isSendingAnswers={actions.actionState.submitAnswersMutation.isPending}
        isTerminal={data.isTerminal}
        isWaitingOnRateLimit={data.isWaitingOnRateLimit}
        isWaitingOnRetry={data.isWaitingOnRetry}
        isChatSession={data.isChatSession}
        pendingQuestions={data.pendingQuestions}
        onAnswerQuestions={actions.actionState.onSubmitAnswers}
      />

      {showWorkflowDetails ? (
        <SessionWorkflowDetailsCard
          threadId={threadId}
          workflowId={data.workflowRun.data?.workflow_id}
          workflowRunId={data.workflowRun.data?.id}
          workflowName={data.workflowName}
          status={data.workflowRun.data?.status}
          currentStepId={data.workflowRun.data?.current_step_id}
          runtimeNotice={data.runtimeNotice}
        />
      ) : null}
    </div>
  );
}