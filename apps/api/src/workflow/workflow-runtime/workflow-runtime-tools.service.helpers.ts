import { BadRequestException } from '@nestjs/common';
import { isRecord, type InternalToolExecutionContext } from '@nexus/core';
import type { SubagentCapabilityContext } from './workflow-runtime-tools.service.helpers.types';
import { parseAgentExecutionContext } from './workflow-runtime-tools.context';

type SubagentCapabilityUser = {
  agentProfileName?: string;
  allowedTools?: unknown;
  isSubagent?: boolean;
  jobId?: string;
  parentJobId?: string;
  subagentExecutionId?: string;
  workflowRunId?: string;
};

export function resolveSubagentCapabilityContext(params: {
  workflow_run_id?: string;
  job_id?: string;
  user?: SubagentCapabilityUser;
}): SubagentCapabilityContext | null {
  const user = params.user;
  if (!user?.isSubagent) {
    return null;
  }

  assertMatchingWorkflowRunId(params.workflow_run_id, user.workflowRunId);
  const context = {
    agentProfileName: user.agentProfileName?.trim() ?? '',
    allowedTools: normalizeStringList(user.allowedTools),
    parentJobId: user.parentJobId,
    requestedJobId: params.job_id ?? user.jobId ?? user.subagentExecutionId,
    subagentExecutionId: user.subagentExecutionId ?? user.jobId ?? '',
    workflowRunId: params.workflow_run_id ?? user.workflowRunId ?? '',
  };
  assertSubagentContext(context);

  return context;
}

function assertMatchingWorkflowRunId(
  requestedWorkflowRunId: string | undefined,
  userWorkflowRunId: string | undefined,
): void {
  if (
    requestedWorkflowRunId &&
    userWorkflowRunId &&
    requestedWorkflowRunId !== userWorkflowRunId
  ) {
    throw new BadRequestException(
      'workflow_run_id does not match authenticated agent context',
    );
  }
}

function assertSubagentContext(context: SubagentCapabilityContext): void {
  if (
    context.requestedJobId &&
    context.requestedJobId !== context.subagentExecutionId
  ) {
    throw new BadRequestException(
      'job_id does not match authenticated subagent context',
    );
  }
  if (!context.agentProfileName) {
    throw new BadRequestException('subagent agent profile is required');
  }
  if (!context.workflowRunId) {
    throw new BadRequestException('subagent workflow_run_id is required');
  }
  if (!context.subagentExecutionId) {
    throw new BadRequestException('subagent execution id is required');
  }
  if (context.allowedTools.length === 0) {
    throw new BadRequestException('subagent delegated tools are required');
  }
}

export function buildSubagentCapabilitiesResponse(params: {
  context: SubagentCapabilityContext;
  scopeId: string | null;
  callableTools: string[];
  deniedTools: string[];
  approvalRequiredTools: string[];
  agentToolPolicy: unknown;
  standingOrders: unknown[];
}): Record<string, unknown> {
  return {
    workflow_run_id: params.context.workflowRunId,
    job_id: params.context.subagentExecutionId,
    ...(params.context.parentJobId
      ? { parent_job_id: params.context.parentJobId }
      : {}),
    agent_profile_name: params.context.agentProfileName,
    scope_id: params.scopeId,
    orchestration_mode: null,
    callable_tools: sortStringArray(params.callableTools),
    denied_tools: params.deniedTools.map((toolName) => ({
      toolName,
      reasonCode: 'profile_denied',
      reason: `Tool ${toolName} is not allowed by subagent profile ${params.context.agentProfileName}.`,
      policyAuthority: 'agent_profile',
    })),
    approval_required_tools: sortStringArray(params.approvalRequiredTools),
    agent_tool_policy: params.agentToolPolicy,
    required_next_action: 'none',
    standing_orders: params.standingOrders,
  };
}

export function normalizeScopeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (
    !trimmed ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed,
    )
  ) {
    return null;
  }

  return trimmed;
}

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const names = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (trimmed) {
      names.add(trimmed);
    }
  }

  return Array.from(names);
}

export function resolveScopeIdFromStateVariables(
  stateVariables: Record<string, unknown>,
): string | null {
  const trigger = isRecord(stateVariables.trigger)
    ? stateVariables.trigger
    : undefined;

  return (
    normalizeScopeId(trigger?.scopeId) ?? normalizeScopeId(trigger?.scope_id)
  );
}

export function sortStringArray(items: string[]): string[] {
  return [...items].sort((a, b) => a.localeCompare(b));
}

export function resolveChatSessionIdFromUser(
  workflowRunId: string | undefined,
  jobId: string | undefined,
  userId: string | undefined,
): string | null {
  if (workflowRunId || jobId || !userId?.startsWith('agent:chat:')) {
    return null;
  }

  const parts = userId.split(':');
  if (parts.length < 3) {
    return null;
  }

  const chatSessionId = parts[2]?.trim();
  return chatSessionId || null;
}

export function resolveJobByIdOrStepId<
  TJob extends { id: string; steps?: Array<{ id?: string }> },
>(jobs: TJob[], identifier: string): TJob | undefined {
  const exactMatch = jobs.find((entry) => entry.id === identifier);
  if (exactMatch) {
    return exactMatch;
  }

  const stepMatches = jobs.filter((entry) =>
    (entry.steps ?? []).some((step) => step.id === identifier),
  );

  return stepMatches.length === 1 ? stepMatches[0] : undefined;
}

export function resolveAuthoritativeWorkflowRunId(
  explicitWorkflowRunId: string | undefined,
  agentWorkflowRunId: string | undefined,
): string | undefined {
  if (
    agentWorkflowRunId &&
    explicitWorkflowRunId &&
    explicitWorkflowRunId !== agentWorkflowRunId
  ) {
    throw new BadRequestException(
      'workflow_run_id does not match authenticated agent context',
    );
  }

  return agentWorkflowRunId ?? explicitWorkflowRunId;
}

export function resolveAuthoritativeJobId(
  explicitJobId: string | undefined,
  agentJobId: string | undefined,
): string | undefined {
  if (agentJobId && explicitJobId && explicitJobId !== agentJobId) {
    throw new BadRequestException(
      'job_id does not match authenticated agent context',
    );
  }

  return agentJobId ?? explicitJobId;
}

export async function resolveInternalToolScopeId(params: {
  workflowRunId?: string;
  workflowRunStateVariables?: unknown;
  explicitScopeId?: string;
  payloadScopeId?: string;
  findRunById: (id: string) => Promise<{ state_variables?: unknown } | null>;
}): Promise<string | undefined> {
  if (params.workflowRunId) {
    const run = params.workflowRunStateVariables
      ? { state_variables: params.workflowRunStateVariables }
      : await params.findRunById(params.workflowRunId);
    const stateVariables = isRecord(run?.state_variables)
      ? run.state_variables
      : undefined;
    const trigger = isRecord(stateVariables?.trigger)
      ? stateVariables.trigger
      : undefined;
    const fromTrigger = normalizeScopeId(trigger?.scopeId);
    if (fromTrigger) {
      return fromTrigger;
    }
    const fromTriggerScopeId = normalizeScopeId(trigger?.scope_id);
    if (fromTriggerScopeId) {
      return fromTriggerScopeId;
    }
  }
  const explicit = normalizeScopeId(params.explicitScopeId);
  if (explicit) {
    return explicit;
  }
  return normalizeScopeId(params.payloadScopeId) ?? undefined;
}

export async function buildInternalToolContext(params: {
  payload: Record<string, unknown>;
  workflow_run_id?: string;
  job_id?: string;
  scope_id?: string;
  user?: {
    userId?: string;
    roles?: string[];
    agentProfileName?: string;
  };
  workflowRunStateVariables?: unknown;
  authoritativeWorkflowRunId?: string;
  authoritativeJobId?: string;
  findRunById: (id: string) => Promise<{ state_variables?: unknown } | null>;
}): Promise<InternalToolExecutionContext> {
  const agentContext = parseAgentExecutionContext(params.user?.userId);
  const workflowRunId =
    params.authoritativeWorkflowRunId ??
    resolveAuthoritativeWorkflowRunId(
      params.workflow_run_id,
      agentContext?.workflowRunId,
    );
  const jobId =
    params.authoritativeJobId ??
    resolveAuthoritativeJobId(params.job_id, agentContext?.jobId);

  const payloadScopeId =
    typeof params.payload.scope_id === 'string'
      ? params.payload.scope_id
      : undefined;
  const resolvedScopeId = await resolveInternalToolScopeId({
    workflowRunId,
    workflowRunStateVariables: params.workflowRunStateVariables,
    explicitScopeId: params.scope_id,
    payloadScopeId,
    findRunById: params.findRunById,
  });
  return {
    workflowRunId,
    jobId,
    scopeId: resolvedScopeId,
    userId: params.user?.userId,
    userRoles: params.user?.roles,
    agentProfileName: params.user?.agentProfileName,
  };
}

export function toAgentProfileRuntimeSummary(profile: {
  id: string;
  name: string;
  is_active: boolean;
  tier_preference?: string | null;
  model_name?: string | null;
  provider_name?: string | null;
  allowed_tools?: string[] | null;
  system_prompt?: string | null;
  source: string;
  created_at: Date;
  updated_at: Date;
}): Record<string, unknown> {
  return {
    id: profile.id,
    name: profile.name,
    is_active: profile.is_active,
    tier_preference: profile.tier_preference ?? null,
    model_name: profile.model_name ?? null,
    provider_name: profile.provider_name ?? null,
    allowed_tools: profile.allowed_tools ?? [],
    system_prompt: profile.system_prompt ?? null,
    source: profile.source,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}
