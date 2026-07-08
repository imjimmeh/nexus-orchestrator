import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkflowRunStatus } from "@/lib/api/common.types";
import { WorkflowRunRuntimeNotice } from "@/lib/api/workflows.types";
import { formatRetryTime } from "./sessionConversationPane.helpers";

interface SessionWorkflowDetailsCardProps {
  threadId: string;
  workflowId: string | undefined;
  workflowRunId: string | undefined;
  workflowName: string | undefined;
  status: WorkflowRunStatus | undefined;
  currentStepId: string | null | undefined;
  runtimeNotice: WorkflowRunRuntimeNotice | null;
}

function DetailRow({
  label,
  children,
}: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-right font-mono">{children}</span>
    </div>
  );
}

function runtimeStateLabel(params: {
  status: WorkflowRunStatus | undefined;
  runtimeNotice: WorkflowRunRuntimeNotice | null;
}): string {
  if (params.runtimeNotice?.isWaitingOnRetry) {
    return "retry scheduled";
  }

  if (params.runtimeNotice?.kind === "error") {
    return "error";
  }

  return params.status?.toLowerCase() ?? "unknown";
}

function WorkflowIdDetailRow({
  workflowId,
  workflowName,
  threadId,
}: Readonly<{
  workflowId: string | undefined;
  workflowName: string | undefined;
  threadId: string;
}>) {
  return (
    <DetailRow label="Workflow ID">
      {workflowId ? (
        <Link
          to={`/workflows/${workflowId}`}
          className="underline-offset-2 hover:underline"
        >
          {workflowName ?? workflowId}
        </Link>
      ) : (
        threadId.slice(0, 12)
      )}
    </DetailRow>
  );
}

function WorkflowRunDetailRow({
  workflowId,
  workflowRunId,
}: Readonly<{
  workflowId: string | undefined;
  workflowRunId: string | undefined;
}>) {
  if (!workflowId || !workflowRunId) {
    return null;
  }

  return (
    <DetailRow label="Run">
      <Link
        to={`/workflows/${workflowId}/runs/${workflowRunId}`}
        className="underline-offset-2 hover:underline"
      >
        {workflowRunId.slice(0, 12)}
      </Link>
    </DetailRow>
  );
}

function JobDetailRow({
  currentStepId,
  retryMetadata,
}: Readonly<{
  currentStepId: string | null | undefined;
  retryMetadata: WorkflowRunRuntimeNotice["retryMetadata"];
}>) {
  const jobId = currentStepId ?? retryMetadata?.jobId;
  if (!jobId) {
    return null;
  }

  return <DetailRow label="Current job">{jobId}</DetailRow>;
}

function RetryAndErrorRows({
  retryMetadata,
  errorSummary,
}: Readonly<{
  retryMetadata: WorkflowRunRuntimeNotice["retryMetadata"];
  errorSummary: WorkflowRunRuntimeNotice["errorSummary"];
}>) {
  const lastError = errorSummary?.message ?? retryMetadata?.message;

  return (
    <>
      {retryMetadata?.nextRetryAt ? (
        <DetailRow label="Next retry">
          {formatRetryTime(retryMetadata.nextRetryAt)}
        </DetailRow>
      ) : null}
      {retryMetadata?.retryQueueJobId ? (
        <DetailRow label="Queue job">
          <span title={retryMetadata.retryQueueJobId}>
            {retryMetadata.retryQueueJobId.slice(0, 18)}
          </span>
        </DetailRow>
      ) : null}
      {lastError ? <DetailRow label="Last error">{lastError}</DetailRow> : null}
    </>
  );
}

export function SessionWorkflowDetailsCard({
  threadId,
  workflowId,
  workflowRunId,
  workflowName,
  status,
  currentStepId,
  runtimeNotice,
}: Readonly<SessionWorkflowDetailsCardProps>) {
  const retryMetadata = runtimeNotice?.retryMetadata;
  const errorSummary = runtimeNotice?.errorSummary;

  return (
    <div className="border-t p-4 bg-muted/50 max-h-48 overflow-y-auto">
      <Card className="border-0 bg-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Details</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-1">
          <WorkflowIdDetailRow
            workflowId={workflowId}
            workflowName={workflowName}
            threadId={threadId}
          />
          <WorkflowRunDetailRow
            workflowId={workflowId}
            workflowRunId={workflowRunId}
          />
          <DetailRow label="Runtime state">
            {runtimeStateLabel({ status, runtimeNotice })}
          </DetailRow>
          <JobDetailRow
            currentStepId={currentStepId}
            retryMetadata={retryMetadata}
          />
          <RetryAndErrorRows
            retryMetadata={retryMetadata}
            errorSummary={errorSummary}
          />
        </CardContent>
      </Card>
    </div>
  );
}
