import { WorkflowRun, WorkflowRunErrorSummary, WorkflowRunRetryMetadata, WorkflowRunRuntimeNotice, WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { asRecord, readPath, readString, readNumber } from "@/lib/deep-paths";

const RETRY_EVENT_TYPES = new Set([
  "workflow.retry_scheduled",
  "core.workflow.step.retry_scheduled.v1",
]);

const FAILURE_EVENT_TYPES = new Set([
  "workflow.turn.completed",
  "workflow.agent.completed",
  "turn_end",
  "agent_end",
  "job.failed",
  "core.workflow.step.failed.v1",
  "job.output_contract.missing",
  "job.output_contract.exhausted",
]);

function isFalseLike(value: unknown): boolean {
  return value === false || value === "false";
}

function normalizeUsageLimit(
  value: unknown,
): WorkflowRunRetryMetadata["usageLimit"] {
  const usage = asRecord(value);
  if (!usage) {
    return undefined;
  }

  return {
    used: readNumber(usage, ["used"]),
    limit: readNumber(usage, ["limit"]),
    resetAt: readString(usage, ["resetAt", "reset_at"]),
  };
}

function readJobId(
  record: Record<string, unknown> | undefined | null,
  fallback?: string | null,
): string | undefined {
  return (
    readString(record, ["jobId", "job_id", "job", "currentJobId"]) ??
    fallback ??
    undefined
  );
}

function readStepId(
  record: Record<string, unknown> | undefined | null,
  fallback?: string,
): string | undefined {
  return readString(record, ["stepId", "step_id", "step"]) ?? fallback;
}

interface RetryMetadataSource {
  jobId?: string;
  entry?: Record<string, unknown> | null;
  failure?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
}

function readRetryString(
  source: RetryMetadataSource,
  keys: string[],
  payloadKeys = keys,
): string | undefined {
  return (
    readString(source.failure, keys) ?? readString(source.payload, payloadKeys)
  );
}

function readRetryNumber(
  source: RetryMetadataSource,
  keys: string[],
  payloadKeys = keys,
): number | undefined {
  return (
    readNumber(source.failure, keys) ?? readNumber(source.payload, payloadKeys)
  );
}

function readRetryAttempt(source: RetryMetadataSource): number | undefined {
  return (
    readNumber(source.failure, ["attempt"]) ??
    readNumber(source.entry, ["attempt"]) ??
    readNumber(source.payload, ["attempt"])
  );
}

function buildRetryMetadata(
  source: RetryMetadataSource,
): WorkflowRunRetryMetadata {
  return {
    jobId: readJobId(source.failure, source.jobId) ?? readJobId(source.payload),
    stepId: readStepId(source.failure) ?? readStepId(source.payload),
    reason: readRetryString(source, ["reason"]),
    message: readRetryString(
      source,
      ["message", "errorMessage", "error"],
      ["message", "reason", "errorMessage", "error"],
    ),
    reasonCode: readRetryString(source, ["reasonCode", "reason_code"]),
    attempt: readRetryAttempt(source),
    maxAttempts: readNumber(source.payload, ["maxAttempts", "max_attempts"]),
    delayMs: readRetryNumber(source, ["delayMs", "delay_ms"]),
    retryQueueJobId: readRetryString(
      source,
      ["retryQueueJobId", "retry_queue_job_id"],
      ["retryQueueJobId", "retry_queue_job_id", "retryJobId"],
    ),
    nextRetryAt: readRetryString(source, ["nextRetryAt", "next_retry_at"]),
    resetAt: readRetryString(source, ["resetAt", "reset_at"]),
    rateLimitResetAt: readRetryString(source, [
      "rateLimitResetAt",
      "rate_limit_reset_at",
      "resetAt",
      "reset_at",
    ]),
    providerTier: readRetryString(source, ["providerTier", "provider_tier"]),
    usageLimit:
      normalizeUsageLimit(source.failure?.usageLimit) ??
      normalizeUsageLimit(source.payload?.usageLimit),
  };
}

function buildRetryMetadataFromRecord(params: {
  jobId?: string;
  entry?: Record<string, unknown> | null;
  failure?: Record<string, unknown> | null;
  retryEvent?: WorkflowTelemetryEvent;
}): WorkflowRunRetryMetadata | null {
  const metadata = buildRetryMetadata({
    jobId: params.jobId,
    entry: params.entry,
    failure: params.failure,
    payload: asRecord(params.retryEvent?.payload),
  });

  if (
    !metadata.nextRetryAt &&
    !metadata.retryQueueJobId &&
    !metadata.reasonCode
  ) {
    return null;
  }

  return metadata;
}

function findRetryEventForJob(
  events: WorkflowTelemetryEvent[],
  jobId: string | undefined,
): WorkflowTelemetryEvent | undefined {
  return [...events].reverse().find((event) => {
    if (!RETRY_EVENT_TYPES.has(event.event_type)) {
      return false;
    }

    if (!jobId) {
      return true;
    }

    return readJobId(event.payload) === jobId;
  });
}

function toRetryTimestamp(metadata: WorkflowRunRetryMetadata): number {
  const parsed = metadata.nextRetryAt
    ? new Date(metadata.nextRetryAt).getTime()
    : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function deriveWorkflowRunRetryMetadata(
  workflowRun: WorkflowRun | null | undefined,
  events: WorkflowTelemetryEvent[],
): WorkflowRunRetryMetadata | null {
  const autoRetry = asRecord(
    readPath(workflowRun?.state_variables, ["_internal", "auto_retry"]),
  );
  const entries = autoRetry
    ? Object.entries(autoRetry)
        .map(([jobId, value]) => {
          const entry = asRecord(value);
          const failure = asRecord(entry?.last_failure);
          // A retry is only *pending* while its `last_failure` marker is live in
          // state. The server clears that marker the moment the retry activates
          // (and removes the whole entry on completion/terminal failure), leaving
          // only the attempt-budget accounting behind. Historical
          // `retry_scheduled` telemetry is immutable, so deriving "waiting on
          // retry" from events alone would keep the banner stuck after the retry
          // has already run. Require live state; use events only to enrich it.
          if (!failure) {
            return null;
          }
          return buildRetryMetadataFromRecord({
            jobId,
            entry,
            failure,
            retryEvent: findRetryEventForJob(events, jobId),
          });
        })
        .filter((entry): entry is WorkflowRunRetryMetadata => entry !== null)
    : [];

  if (entries.length === 0) {
    return null;
  }

  const currentJobEntry = entries.find(
    (entry) => entry.jobId === workflowRun?.current_step_id,
  );
  if (currentJobEntry) {
    return currentJobEntry;
  }

  return [...entries].sort(
    (a, b) =>
      toRetryTimestamp(b) - toRetryTimestamp(a) ||
      (b.attempt ?? 0) - (a.attempt ?? 0),
  )[0];
}

function isFailureEvent(event: WorkflowTelemetryEvent): boolean {
  if (!FAILURE_EVENT_TYPES.has(event.event_type)) {
    return false;
  }

  const payload = event.payload;
  const output = asRecord(payload.output);
  const result = asRecord(payload.result);

  if (event.event_type === "job.output_contract.missing") {
    return payload.willRetry !== true;
  }

  const hasExplicitFailure =
    payload.outcome === "failure" ||
    payload.status === "FAILED" ||
    payload.stopReason === "error" ||
    isFalseLike(payload.ok) ||
    isFalseLike(output?.ok) ||
    isFalseLike(result?.ok);

  if (hasExplicitFailure) {
    return true;
  }

  if (event.event_type === "agent_end" || event.event_type === "turn_end") {
    return false;
  }

  const hasErrorMessage =
    readString(payload, ["errorMessage", "error", "message"]) !== undefined ||
    readString(output, ["errorMessage", "error", "message"]) !== undefined;

  return hasErrorMessage;
}

function buildOutputContractMessage(payload: Record<string, unknown>): string {
  const missingFields = Array.isArray(payload.missingFields)
    ? payload.missingFields.filter(
        (field): field is string => typeof field === "string",
      )
    : [];

  if (missingFields.length > 0) {
    return `Output contract missing fields: ${missingFields.join(", ")}`;
  }

  return "Output contract fields were not provided.";
}

function toErrorSummary(
  event: WorkflowTelemetryEvent,
): WorkflowRunErrorSummary | null {
  if (!isFailureEvent(event)) {
    return null;
  }

  const payload = event.payload;
  const output = asRecord(payload.output);
  const result = asRecord(payload.result);
  const message =
    readString(payload, ["errorMessage", "error", "message", "reason"]) ??
    readString(output, ["errorMessage", "error", "message", "stopReason"]) ??
    readString(result, ["errorMessage", "error", "message"]) ??
    (event.event_type.startsWith("job.output_contract")
      ? buildOutputContractMessage(payload)
      : "Workflow job reported a failure.");

  return {
    eventType: event.event_type,
    message,
    occurredAt: event.timestamp,
    jobId: readJobId(payload),
    stepId: readStepId(payload),
    reasonCode: readString(payload, ["reasonCode", "reason_code"]),
    retryable: payload.retryable === true,
  };
}

function isSubagentScopedEvent(event: WorkflowTelemetryEvent): boolean {
  const payload = event.payload;
  return (
    payload.isSubagent === true ||
    typeof payload.subagentExecutionId === "string"
  );
}

export function deriveWorkflowRunErrorSummary(
  events: WorkflowTelemetryEvent[],
): WorkflowRunErrorSummary | null {
  for (const event of [...events].reverse()) {
    if (isSubagentScopedEvent(event)) {
      continue;
    }
    const summary = toErrorSummary(event);
    if (summary) {
      return summary;
    }
  }

  return null;
}

function hasFailureStateOutput(output: Record<string, unknown>): boolean {
  // A job skipped by an unmet `condition`/`if` records a `reason`
  // (e.g. "condition_false") alongside `skipped: true`. That is normal
  // control flow, not a failure, so it must never surface as an error.
  if (output.skipped === true) {
    return false;
  }

  if (isFalseLike(output.ok)) {
    return true;
  }

  const mergeOutcome = readString(output, ["merge_outcome", "mergeOutcome"]);
  if (
    mergeOutcome === "failed" ||
    mergeOutcome === "auth_error" ||
    mergeOutcome === "conflict"
  ) {
    return true;
  }

  return (
    readString(output, ["errorMessage", "error", "message", "reason"]) !==
    undefined
  );
}

function deriveWorkflowRunErrorSummaryFromState(
  workflowRun: WorkflowRun | null | undefined,
): WorkflowRunErrorSummary | null {
  const jobs = asRecord(readPath(workflowRun?.state_variables, ["jobs"]));
  if (!jobs) {
    return null;
  }

  const currentJobId =
    typeof workflowRun?.current_step_id === "string"
      ? workflowRun.current_step_id
      : undefined;

  const entries = Object.entries(jobs)
    .map(([jobId, value]) => ({
      jobId,
      output: asRecord(asRecord(value)?.output),
    }))
    .filter(
      (entry): entry is { jobId: string; output: Record<string, unknown> } =>
        entry.output !== null && entry.output !== undefined,
    );

  const selected =
    entries.find(
      (entry) =>
        entry.jobId === currentJobId && hasFailureStateOutput(entry.output),
    ) ?? entries.find((entry) => hasFailureStateOutput(entry.output));

  if (!selected) {
    return null;
  }

  const message =
    readString(selected.output, [
      "errorMessage",
      "error",
      "message",
      "reason",
      "merge_message",
    ]) ?? "Workflow job output indicates a failure.";

  return {
    eventType: "workflow.state.output",
    message,
    occurredAt: workflowRun?.updated_at,
    jobId: selected.jobId,
  };
}

function titleForRetry(metadata: WorkflowRunRetryMetadata): string {
  if (metadata.reasonCode === "provider_rate_limit_429") {
    return "Provider rate limit retry scheduled";
  }

  if (metadata.reasonCode === "provider_overload_529") {
    return "Provider high traffic retry scheduled";
  }

  return "Workflow retry queued";
}

function retryKind(
  metadata: WorkflowRunRetryMetadata,
): WorkflowRunRuntimeNotice["kind"] {
  if (metadata.reasonCode === "provider_rate_limit_429") {
    return "provider_rate_limit_retry";
  }

  if (metadata.reasonCode === "provider_overload_529") {
    return "provider_overload_retry";
  }

  return "retry_scheduled";
}

export function buildWorkflowRunRuntimeNotice(params: {
  workflowRun: WorkflowRun | null | undefined;
  events: WorkflowTelemetryEvent[];
}): WorkflowRunRuntimeNotice | null {
  // A retry can only be pending while the run is still active. A terminal run
  // (FAILED/COMPLETED/CANCELLED) that happens to retain stale auto_retry state
  // must surface its error, never a "waiting on retry" banner.
  const retryMetadata =
    params.workflowRun?.status === "RUNNING"
      ? deriveWorkflowRunRetryMetadata(params.workflowRun, params.events)
      : null;
  if (retryMetadata) {
    return {
      kind: retryKind(retryMetadata),
      severity: "warning",
      title: titleForRetry(retryMetadata),
      message:
        retryMetadata.message ??
        retryMetadata.reason ??
        "The workflow is waiting for a delayed retry. A new execution container is expected at retry time.",
      retryMetadata,
      isWaitingOnRetry: true,
    };
  }

  const errorSummary =
    deriveWorkflowRunErrorSummary(params.events) ??
    deriveWorkflowRunErrorSummaryFromState(params.workflowRun);
  if (errorSummary) {
    return {
      kind: "error",
      severity: "error",
      title: "Workflow error",
      message: errorSummary.message,
      errorSummary,
      isWaitingOnRetry: false,
    };
  }

  return null;
}
