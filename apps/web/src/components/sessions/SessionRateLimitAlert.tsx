import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChatSessionRetryMetadata } from "@/lib/api/chat-sessions.types";
import {
  formatRetryCountdown,
  formatRetryTime,
  formatUsageLimit,
} from "./sessionConversationPane.helpers";

interface SessionRateLimitAlertProps {
  retryMetadata: ChatSessionRetryMetadata;
  onRetryNow: () => void;
  isRetryPending: boolean;
}

export function SessionRateLimitAlert({
  retryMetadata,
  onRetryNow,
  isRetryPending,
}: Readonly<SessionRateLimitAlertProps>) {
  return (
    <Alert className="m-4 border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-300" />
      <AlertTitle>Provider rate limit retry scheduled</AlertTitle>
      <AlertDescription className="space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {retryMetadata.nextRetryAt ? (
            <span>
              Retry: {formatRetryCountdown(retryMetadata.nextRetryAt)} (
              {formatRetryTime(retryMetadata.nextRetryAt)})
            </span>
          ) : null}
          {retryMetadata.rateLimitResetAt ? (
            <span>
              Reset: {formatRetryTime(retryMetadata.rateLimitResetAt)}
            </span>
          ) : null}
          {retryMetadata.attempt !== undefined ? (
            <span>
              Attempt {retryMetadata.attempt}
              {retryMetadata.maxAttempts !== undefined
                ? ` of ${retryMetadata.maxAttempts}`
                : ""}
            </span>
          ) : null}
          {retryMetadata.providerTier ? (
            <span>Tier: {retryMetadata.providerTier}</span>
          ) : null}
          {formatUsageLimit(retryMetadata.usageLimit) ? (
            <span>Usage: {formatUsageLimit(retryMetadata.usageLimit)}</span>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-amber-300 bg-white/60 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100 dark:hover:bg-amber-900/40"
          onClick={onRetryNow}
          disabled={isRetryPending}
        >
          {isRetryPending ? "Retrying..." : "Retry now"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
