import {
  parseAgentExecutionContext,
  resolveWorkflowRunIdFromToken,
} from './workflow-runtime-tools.context';
import type {
  AgentUserContext,
  DeniedCapabilityInfo,
  RuntimeContext,
  RuntimeContextInput,
} from './workflow-runtime-capability-lifecycle.types';

export function resolveRuntimeContext(
  context: RuntimeContextInput,
): RuntimeContext {
  const parsedFromToken = parseAgentExecutionContext(context.user?.userId);
  const workflowRunId =
    context.workflow_run_id ??
    parsedFromToken?.workflowRunId ??
    resolveWorkflowRunIdFromToken(context.user) ??
    null;
  const jobId = context.job_id ?? parsedFromToken?.jobId ?? null;
  const chatSessionId = context.chat_session_id ?? null;

  return {
    workflowRunId,
    jobId,
    chatSessionId,
    user: context.user,
  };
}

export function isAgentInvocation(user: AgentUserContext | undefined): boolean {
  if (!user) {
    return false;
  }

  if (parseAgentExecutionContext(user.userId) !== null) {
    return true;
  }

  if (!Array.isArray(user.roles)) {
    return false;
  }

  return user.roles.includes('Agent');
}

export function findDeniedCapabilityInfo(
  deniedTools: unknown,
  capabilityName: string,
): DeniedCapabilityInfo {
  if (!Array.isArray(deniedTools)) {
    return {};
  }

  for (const entry of deniedTools) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    if (record.toolName !== capabilityName) {
      continue;
    }

    return {
      reason: asOptionalTrimmedString(record.reason),
      reasonCode: asOptionalTrimmedString(record.reasonCode),
    };
  }

  return {};
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [...new Set(normalized)];
}

export function resolveActorType(
  user: AgentUserContext | undefined,
): 'agent' | 'user' | 'system' {
  if (!user?.userId) {
    return 'system';
  }

  if (parseAgentExecutionContext(user.userId) !== null) {
    return 'agent';
  }

  return 'user';
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message;
  }

  return 'Unknown runtime capability error';
}

function asOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
