import { WorkflowRun, WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type StepOutput = {
  stepId: string;
  output: Record<string, unknown>;
};

type RateLimitRetryMetadata = {
  reasonCode?: string;
  retryCategory?: string;
  nextRetryAt?: string;
  resetAt?: string;
  rateLimitResetAt?: string;
  attempt?: number;
  maxAttempts?: number;
  providerTier?: string;
  usageLimit?: {
    used: number;
    limit: number;
    unit: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toRetryFailureMetadataCandidate(
  value: unknown,
): RateLimitRetryMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const reasonCode =
    typeof value.reasonCode === "string" ? value.reasonCode : undefined;
  const retryCategory =
    typeof value.retryCategory === "string" ? value.retryCategory : undefined;

  if (!reasonCode && !retryCategory) {
    return null;
  }

  return value as RateLimitRetryMetadata;
}

function isProviderRateLimitRetryMetadata(
  metadata: RateLimitRetryMetadata,
): boolean {
  return (
    metadata.reasonCode === "provider_rate_limit_429" ||
    metadata.retryCategory === "provider_rate_limit_429"
  );
}

function getRetryFailureMetadataCandidateTime(
  metadata: RateLimitRetryMetadata,
): number {
  const timestamp =
    metadata.nextRetryAt ??
    metadata.resetAt ??
    metadata.rateLimitResetAt ??
    undefined;

  if (!timestamp) {
    return Number.NaN;
  }

  return Date.parse(timestamp);
}

function getLatestRetryFailureMetadataCandidate(
  candidates: RateLimitRetryMetadata[],
): RateLimitRetryMetadata | null {
  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((latest, candidate, index) => {
    const latestTime = getRetryFailureMetadataCandidateTime(latest);
    const candidateTime = getRetryFailureMetadataCandidateTime(candidate);
    const latestComparable = Number.isFinite(latestTime)
      ? latestTime
      : index - 1;
    const candidateComparable = Number.isFinite(candidateTime)
      ? candidateTime
      : index;

    return candidateComparable >= latestComparable ? candidate : latest;
  });
}

function collectNestedRetryFailureMetadataCandidates(
  value: unknown,
  candidates: RateLimitRetryMetadata[] = [],
): RateLimitRetryMetadata[] {
  const direct = toRetryFailureMetadataCandidate(value);
  if (direct) {
    candidates.push(direct);
    return candidates;
  }

  if (!isRecord(value)) {
    return candidates;
  }

  const lastFailure = toRetryFailureMetadataCandidate(value.last_failure);
  if (lastFailure) {
    candidates.push({
      ...lastFailure,
      attempt:
        typeof value.attempt === "number" ? value.attempt : lastFailure.attempt,
      maxAttempts:
        typeof value.maxAttempts === "number"
          ? value.maxAttempts
          : lastFailure.maxAttempts,
    });
    return candidates;
  }

  for (const nested of Object.values(value)) {
    collectNestedRetryFailureMetadataCandidates(nested, candidates);
  }

  return candidates;
}

function findNestedRetryFailureMetadataCandidate(
  value: unknown,
): RateLimitRetryMetadata | null {
  return getLatestRetryFailureMetadataCandidate(
    collectNestedRetryFailureMetadataCandidates(value),
  );
}

export function getWorkflowRateLimitRetryMetadata(
  run: WorkflowRun,
  events: WorkflowTelemetryEvent[],
): RateLimitRetryMetadata | null {
  let latestCandidate = findNestedRetryFailureMetadataCandidate(
    run.state_variables,
  );
  let latestEventTimestamp = Number.NEGATIVE_INFINITY;

  events.forEach((event, index) => {
    const eventType = event.event_type.toLowerCase();
    if (!eventType.includes("retry") && !eventType.includes("fail")) {
      return;
    }

    const timestamp = Date.parse(event.timestamp);
    const comparableTimestamp = Number.isFinite(timestamp) ? timestamp : index;
    if (comparableTimestamp >= latestEventTimestamp) {
      latestCandidate = findNestedRetryFailureMetadataCandidate(event.payload);
      latestEventTimestamp = comparableTimestamp;
    }
  });

  return latestCandidate && isProviderRateLimitRetryMetadata(latestCandidate)
    ? latestCandidate
    : null;
}

function formatRetryCountdown(nextRetryAt: string, now = new Date()): string {
  const diffMs = new Date(nextRetryAt).getTime() - now.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "any moment";
  const minutes = Math.ceil(diffMs / 60000);
  return minutes === 1 ? "1 min" : `${minutes} min`;
}

function formatRetryTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

function formatUsageLimit(
  usageLimit: RateLimitRetryMetadata["usageLimit"],
): string | null {
  if (!usageLimit) {
    return null;
  }

  return `${usageLimit.used}/${usageLimit.limit} ${usageLimit.unit}`;
}

export function WorkflowRateLimitRetryCard({
  metadata,
}: Readonly<{ metadata: RateLimitRetryMetadata | null }>) {
  if (!metadata) {
    return null;
  }

  const usageLimit = formatUsageLimit(metadata.usageLimit);
  const resetAt = metadata.rateLimitResetAt ?? metadata.resetAt;

  return (
    <Card className="border-amber-300 bg-amber-50/80 dark:border-amber-700 dark:bg-amber-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-amber-950 dark:text-amber-100">
          Provider rate limit retry scheduled
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-amber-900 dark:text-amber-100">
        {metadata.nextRetryAt && (
          <span>
            Retry: {formatRetryCountdown(metadata.nextRetryAt)} (
            {formatRetryTime(metadata.nextRetryAt)})
          </span>
        )}
        {resetAt && <span>Reset: {formatRetryTime(resetAt)}</span>}
        {metadata.attempt !== undefined && (
          <span>
            Attempt {metadata.attempt}
            {metadata.maxAttempts !== undefined
              ? ` of ${metadata.maxAttempts}`
              : ""}
          </span>
        )}
        {metadata.providerTier && <span>Tier: {metadata.providerTier}</span>}
        {usageLimit && <span>Usage: {usageLimit}</span>}
      </CardContent>
    </Card>
  );
}

export function StepResults({ entries }: Readonly<{ entries: StepOutput[] }>) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No step output captured yet.
      </p>
    );
  }

  return (
    <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
      {entries.map((entry) => (
        <div key={entry.stepId} className="rounded-md border p-2 text-sm">
          <div className="font-medium">{entry.stepId}</div>
          <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {JSON.stringify(entry.output, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}
