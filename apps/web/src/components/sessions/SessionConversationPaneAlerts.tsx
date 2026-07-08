import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ChatSessionRetryMetadata } from "@/lib/api/chat-sessions.types";
import { WorkflowRunRuntimeNotice } from "@/lib/api/workflows.types";
import {
  BudgetStatusBanner,
  type BudgetDecision,
} from "@/components/budget/BudgetStatusBanner";
import { SessionRateLimitAlert } from "./SessionRateLimitAlert";
import { WorkflowRuntimeNoticeAlert } from "./WorkflowRuntimeNoticeAlert";

interface SessionConversationPaneAlertsProps {
  connectionError: unknown;
  isWaitingOnRateLimit: boolean;
  retryMetadata: ChatSessionRetryMetadata | undefined;
  runtimeNotice: WorkflowRunRuntimeNotice | null;
  onRetryNow: () => void;
  isRetryPending: boolean;
  budgetDecision?: BudgetDecision | null;
  budgetReasonCode?: string | null;
  budgetEstimatedCostCents?: number | null;
  budgetRemainingCents?: number | null;
}

export function SessionConversationPaneAlerts({
  connectionError,
  isWaitingOnRateLimit,
  retryMetadata,
  runtimeNotice,
  onRetryNow,
  isRetryPending,
  budgetDecision,
  budgetReasonCode,
  budgetEstimatedCostCents,
  budgetRemainingCents,
}: Readonly<SessionConversationPaneAlertsProps>) {
  return (
    <>
      {budgetDecision ? (
        <div className="m-4">
          <BudgetStatusBanner
            decision={budgetDecision}
            reasonCode={budgetReasonCode}
            estimatedCostCents={budgetEstimatedCostCents}
            remainingBudgetCents={budgetRemainingCents}
          />
        </div>
      ) : null}

      {connectionError ? (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>{String(connectionError)}</AlertDescription>
        </Alert>
      ) : null}

      {isWaitingOnRateLimit && retryMetadata ? (
        <SessionRateLimitAlert
          retryMetadata={retryMetadata}
          onRetryNow={onRetryNow}
          isRetryPending={isRetryPending}
        />
      ) : null}

      {runtimeNotice ? (
        <WorkflowRuntimeNoticeAlert notice={runtimeNotice} />
      ) : null}
    </>
  );
}
