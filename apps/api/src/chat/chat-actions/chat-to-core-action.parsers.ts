import type { WorkflowRunStatusV1 } from '@nexus/core';
import { isRecord } from '@nexus/core';

export function readAcceptedCorrelationId(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const metadata = (value as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  return (
    readNonEmptyString(
      (metadata as { correlation_id?: unknown }).correlation_id,
    ) ??
    readNonEmptyString((metadata as { correlationId?: unknown }).correlationId)
  );
}

export function readStatusCorrelationId(
  status: WorkflowRunStatusV1,
): string | null {
  return (
    readNonEmptyString(status.metadata.correlation_id) ??
    readNonEmptyString(
      (status.metadata as { correlationId?: unknown }).correlationId,
    )
  );
}

export function readRunId(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as { run_id?: unknown; runId?: unknown };
  return readNonEmptyString(record.run_id) ?? readNonEmptyString(record.runId);
}

export function readWorkflowId(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as { workflow_id?: unknown; workflowId?: unknown };
  return (
    readNonEmptyString(record.workflow_id) ??
    readNonEmptyString(record.workflowId)
  );
}

export function readWorkflowRunEvent(value: unknown): {
  event_type: string;
  timestamp: string;
  payload: Record<string, unknown>;
} | null {
  if (!isRecord(value)) {
    return null;
  }

  const eventType = readNonEmptyString(value.event_type);
  if (!eventType) {
    return null;
  }

  const timestamp = readNonEmptyString(value.timestamp) ?? '';
  const payload: Record<string, unknown> = isRecord(value.payload)
    ? value.payload
    : {};

  return {
    event_type: eventType,
    timestamp,
    payload,
  };
}

export function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
