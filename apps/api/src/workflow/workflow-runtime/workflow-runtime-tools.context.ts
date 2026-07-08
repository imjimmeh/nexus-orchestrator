import type { CapabilityDeniedReason } from '../../tool/capability-preflight.types';
import {
  requireNonEmptyString,
  resolveCriticalToolNames,
} from './workflow-runtime-tools.helpers';
import type {
  AgentExecutionContext,
  AgentUserContext,
} from './workflow-runtime-tools.types';

export function parseAgentExecutionContext(
  userId: string | undefined,
): AgentExecutionContext | null {
  if (!userId?.startsWith('agent:')) {
    return null;
  }

  const parts = userId.split(':');
  if (parts.length < 3) {
    return null;
  }

  const workflowRunId = parts[1]?.trim();
  const jobId = parts[2]?.trim();

  if (!workflowRunId || !jobId) {
    return null;
  }

  return { workflowRunId, jobId };
}

export function resolveWorkflowRunId(params: {
  workflowRunId?: string;
  user?: AgentUserContext;
}): string {
  const workflowRunId =
    params.workflowRunId || resolveWorkflowRunIdFromToken(params.user);

  return requireNonEmptyString(workflowRunId, 'workflow_run_id');
}

export function resolveWorkflowRunIdFromToken(
  user: AgentUserContext | undefined,
): string | undefined {
  const userId = user?.userId;
  if (!userId?.startsWith('agent:')) {
    return undefined;
  }

  const segments = userId.split(':');
  return segments[1]?.trim() || undefined;
}

export function resolveStateVariables(
  stateVariables: unknown,
): Record<string, unknown> {
  if (!stateVariables || typeof stateVariables !== 'object') {
    return {};
  }

  return stateVariables as Record<string, unknown>;
}

export function resolveRequiredNextAction(
  snapshot: {
    approvalRequiredToolNames: string[];
    denied: CapabilityDeniedReason[];
  },
  job: { output_contract?: unknown },
): 'approval_required' | 'review_policy_or_mode' | 'none' {
  if (snapshot.approvalRequiredToolNames.length > 0) {
    return 'approval_required';
  }

  const criticalToolNames = resolveCriticalToolNames(job);
  if (criticalToolNames.size === 0) {
    return 'none';
  }

  for (const deniedEntry of snapshot.denied) {
    if (criticalToolNames.has(deniedEntry.toolName)) {
      return 'review_policy_or_mode';
    }
  }

  return 'none';
}
