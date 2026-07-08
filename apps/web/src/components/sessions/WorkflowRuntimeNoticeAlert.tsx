import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WorkflowRunErrorSummary, WorkflowRunRetryMetadata, WorkflowRunRuntimeNotice } from "@/lib/api/workflows.types";
import {
  formatRetryCountdown,
  formatRetryTime,
  formatUsageLimit,
} from "./sessionConversationPane.helpers";

interface WorkflowRuntimeNoticeAlertProps {
  notice: WorkflowRunRuntimeNotice;
}

function shorten(value: string): string {
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

function alertClassName(notice: WorkflowRunRuntimeNotice): string {
  if (notice.severity === "error") {
    return "m-4";
  }

  return "m-4 border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100";
}

function RetryTimingInfo({
  metadata,
}: Readonly<{ metadata: WorkflowRunRetryMetadata | undefined }>) {
  return (
    <>
      {metadata?.nextRetryAt ? (
        <span>
          Retry: {formatRetryCountdown(metadata.nextRetryAt)} (
          {formatRetryTime(metadata.nextRetryAt)})
        </span>
      ) : null}
      {metadata?.rateLimitResetAt ? (
        <span>Reset: {formatRetryTime(metadata.rateLimitResetAt)}</span>
      ) : null}
    </>
  );
}

function RetryAttemptInfo({
  metadata,
}: Readonly<{ metadata: WorkflowRunRetryMetadata | undefined }>) {
  if (metadata?.attempt === undefined) {
    return null;
  }

  const suffix =
    metadata.maxAttempts !== undefined ? ` of ${metadata.maxAttempts}` : "";
  return (
    <span>
      Attempt {metadata.attempt}
      {suffix}
    </span>
  );
}

function RetryMetadataFields({
  metadata,
}: Readonly<{ metadata: WorkflowRunRetryMetadata | undefined }>) {
  const usage = metadata ? formatUsageLimit(metadata.usageLimit) : null;

  return (
    <>
      {metadata?.jobId ? <span>Job: {metadata.jobId}</span> : null}
      {metadata?.stepId ? <span>Step: {metadata.stepId}</span> : null}
      <RetryTimingInfo metadata={metadata} />
      <RetryAttemptInfo metadata={metadata} />
      {metadata?.providerTier ? (
        <span>Tier: {metadata.providerTier}</span>
      ) : null}
      {usage ? <span>Usage: {usage}</span> : null}
      {metadata?.retryQueueJobId ? (
        <span title={metadata.retryQueueJobId}>
          Queue: {shorten(metadata.retryQueueJobId)}
        </span>
      ) : null}
    </>
  );
}

function ErrorSummaryFields({
  summary,
}: Readonly<{ summary: WorkflowRunErrorSummary | undefined }>) {
  return (
    <>
      {summary?.jobId ? <span>Job: {summary.jobId}</span> : null}
      {summary?.stepId ? <span>Step: {summary.stepId}</span> : null}
      {summary?.occurredAt ? (
        <span>Error: {formatRetryTime(summary.occurredAt)}</span>
      ) : null}
    </>
  );
}

function RetryExplanation({ show }: Readonly<{ show: boolean }>) {
  if (!show) {
    return null;
  }

  return (
    <p className="text-sm">
      The current execution container can be cleaned up while the delayed retry
      waits in the queue. A fresh container is expected at retry time.
    </p>
  );
}

export function WorkflowRuntimeNoticeAlert({
  notice,
}: Readonly<WorkflowRuntimeNoticeAlertProps>) {
  return (
    <Alert
      variant={notice.severity === "error" ? "destructive" : "default"}
      className={alertClassName(notice)}
    >
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{notice.message}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <RetryMetadataFields metadata={notice.retryMetadata} />
          <ErrorSummaryFields summary={notice.errorSummary} />
        </div>
        <RetryExplanation show={notice.isWaitingOnRetry} />
      </AlertDescription>
    </Alert>
  );
}
