import { IJob, IToolPermissionPolicy, readString } from '@nexus/core';

export function buildQueuedJobAuditPayload(
  job: IJob,
  workflowPermissions?: IToolPermissionPolicy,
): Record<string, unknown> {
  return {
    jobType: job.type,
    tier: job.tier,
    dependsOn: Array.isArray(job.depends_on) ? job.depends_on : [],
    outputContract: job.output_contract ?? null,
    maxRetries: typeof job.max_retries === 'number' ? job.max_retries : null,
    hasRetryPrompt: readNonEmptyString(job.retry_prompt) !== null,
    workflowToolPolicy: summarizeToolPolicy(workflowPermissions),
    jobToolPolicy: summarizeToolPolicy(job.permissions),
  };
}

function summarizeToolPolicy(
  policy: IToolPermissionPolicy | undefined,
): Record<string, unknown> | null {
  const policyRecord = policy as Record<string, unknown> | undefined;
  if (!policyRecord) {
    return null;
  }

  const allowTools = normalizeToolNames(policyRecord.allow_tools);
  const denyTools = normalizeToolNames(policyRecord.deny_tools);
  if (allowTools.length === 0 && denyTools.length === 0) {
    return null;
  }

  return {
    allowTools,
    denyTools,
  };
}

function normalizeToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const toolNames = new Set<string>();
  for (const entry of value) {
    const toolName = readNonEmptyString(entry);
    if (toolName) {
      toolNames.add(toolName);
    }
  }

  return Array.from(toolNames);
}

function readNonEmptyString(value: unknown): string | null {
  const trimmed = readString(value)?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}
