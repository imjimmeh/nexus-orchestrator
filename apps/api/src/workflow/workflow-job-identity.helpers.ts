const SAFE_IDENTITY_PATTERN = /[^a-zA-Z0-9._-]+/g;
const DUPLICATE_SEPARATOR_PATTERN = /_+/g;

function normalizeIdentitySegment(value: string): string {
  const replaced = value
    .trim()
    .replace(SAFE_IDENTITY_PATTERN, '_')
    .replace(DUPLICATE_SEPARATOR_PATTERN, '_')
    .replace(/^[_-]+/, '')
    .replace(/[_-]+$/, '');

  return replaced;
}

export function sanitizeIdentitySegment(
  value: unknown,
  fallback: string,
): string {
  const input =
    typeof value === 'string'
      ? value
      : typeof value === 'number'
        ? String(value)
        : typeof value === 'boolean'
          ? String(value)
          : typeof value === 'bigint'
            ? value.toString(10)
            : '';
  const normalized = normalizeIdentitySegment(input);
  if (normalized.length > 0) {
    return normalized;
  }

  return normalizeIdentitySegment(fallback);
}

export function buildExecutionMountKey(params: {
  workflowRunId: string;
  jobId: string;
  bullJobId?: string | number;
  now?: () => number;
}): string {
  const run = sanitizeIdentitySegment(params.workflowRunId, 'run');
  const job = sanitizeIdentitySegment(params.jobId, 'job');
  const fallback = String((params.now ?? Date.now)());
  const queueId = sanitizeIdentitySegment(params.bullJobId, fallback);

  return `${run}-${job}-${queueId}`;
}

export function buildWorkflowStepQueueJobId(
  workflowRunId: string,
  jobId: string,
): string {
  const run = sanitizeIdentitySegment(workflowRunId, 'run');
  const job = sanitizeIdentitySegment(jobId, 'job');
  return `workflow-step-${run}-${job}`;
}

export function buildRequiredToolRetryQueueJobId(
  workflowRunId: string,
  jobId: string,
): string {
  const run = sanitizeIdentitySegment(workflowRunId, 'run');
  const job = sanitizeIdentitySegment(jobId, 'job');
  return `required-tool-retry-${run}-${job}`;
}

export function buildAutoRetryQueueJobId(
  workflowRunId: string,
  jobId: string,
): string {
  const run = sanitizeIdentitySegment(workflowRunId, 'run');
  const job = sanitizeIdentitySegment(jobId, 'job');
  return `auto-retry-${run}-${job}`;
}
