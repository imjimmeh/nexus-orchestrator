import { randomUUID } from 'node:crypto';
import { WorkflowRunRequestV1Schema } from '@nexus/core';
import type { ExecutionContext, WorkflowRunRequestV1 } from '@nexus/core';

interface BuildWorkflowRunRequestParams {
  workflow_id: string;
  input: Record<string, unknown>;
  launch_source: string;
  context?: ExecutionContext | null;
  requested_by?: string;
  correlation_id?: string;
  causation_id?: string;
  idempotency_key?: string;
  external_mcp_mounts?: WorkflowRunRequestV1['external_mcp_mounts'];
}

export function buildWorkflowRunRequestV1(
  params: BuildWorkflowRunRequestParams,
): WorkflowRunRequestV1 {
  const workflow_id = normalizeRequiredString(params.workflow_id);
  const launch_source = normalizeRequiredString(params.launch_source);

  const request: WorkflowRunRequestV1 = {
    workflow_id,
    input: params.input,
    launch_source,
    context: params.context ?? null,
    metadata: {
      correlation_id: params.correlation_id ?? randomUUID(),
      causation_id: normalizeNullableString(params.causation_id),
      idempotency_key: normalizeNullableString(params.idempotency_key),
      requested_by: normalizeNullableString(params.requested_by),
    },
    ...(params.external_mcp_mounts
      ? { external_mcp_mounts: params.external_mcp_mounts }
      : {}),
  };

  return WorkflowRunRequestV1Schema.parse(request);
}

function normalizeRequiredString(value: string): string {
  return value.trim();
}

function normalizeNullableString(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
