import { Injectable } from '@nestjs/common';
import { IAMPolicyService } from '../../security/iam-policy.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import type {
  EvaluateMeshDelegationPolicyParams,
  MeshDelegationDenialReason,
  MeshDelegationGovernanceDecision,
} from './mesh-delegation-governance.service.types';

const DEFAULT_PRIVILEGED_TOOLS = [
  'bash',
  'write',
  'publish_tool_candidate',
  'upsert_tool',
  'invoke_agent_workflow',
  'complete_orchestration',
  'create_agent_profile',
] as const;

const DEFAULT_MAX_TOKEN_BUDGET = 200_000;
const DEFAULT_MAX_TIME_BUDGET_MS = 3_600_000;
const MIN_RETRY_ATTEMPTS = 0;
const MAX_RETRY_ATTEMPTS = 5;
const MIN_QUEUE_PRIORITY = 1;
const MAX_QUEUE_PRIORITY = 1000;

interface NormalizedGovernanceInput {
  targetAgentProfile: string;
  requestedTools: string[];
  allowedTools: string[];
  deniedTools: string[];
  tokenBudget: number | null;
  timeBudgetMs: number | null;
  maxRetries: number;
  queuePriority: number;
  allowPrivilegedTools: boolean;
}

@Injectable()
export class MeshDelegationGovernanceService {
  constructor(
    private readonly iamPolicy: IAMPolicyService,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  async evaluate(
    params: EvaluateMeshDelegationPolicyParams,
  ): Promise<MeshDelegationGovernanceDecision> {
    const normalized = this.normalizeInput(params);

    const budgetDenialReason = await this.validateBudgetConstraints(normalized);
    if (budgetDenialReason) {
      return this.buildDeniedDecision(budgetDenialReason, normalized, []);
    }

    const requestedTools = normalized.requestedTools;
    if (requestedTools.length === 0) {
      return this.buildDeniedDecision(
        'requested_tools_missing',
        normalized,
        [],
      );
    }

    const allowedToolViolation = resolveAllowedToolViolation(
      requestedTools,
      normalized.allowedTools,
    );
    if (allowedToolViolation) {
      return this.buildDeniedDecision(
        'requested_tools_not_in_allowed_tools',
        normalized,
        [],
      );
    }

    const deniedIntersection = resolveDeniedToolIntersection(
      requestedTools,
      normalized.deniedTools,
    );
    if (deniedIntersection.length > 0) {
      return this.buildDeniedDecision(
        'requested_tools_blocked_by_denied_tools',
        normalized,
        deniedIntersection,
      );
    }

    const unauthorizedTools = resolveUnauthorizedTargetProfileTools({
      targetAgentProfile: normalized.targetAgentProfile,
      requestedTools,
      evaluateAccess: (profileName, toolName) =>
        this.iamPolicy.evaluateAccess(profileName, toolName),
    });

    if (unauthorizedTools.length > 0) {
      return this.buildDeniedDecision(
        'target_profile_not_authorized_for_requested_tools',
        normalized,
        unauthorizedTools,
      );
    }

    const privilegedTools =
      await this.resolvePrivilegedToolIntersection(requestedTools);
    if (privilegedTools.length > 0 && !normalized.allowPrivilegedTools) {
      return this.buildDeniedDecision(
        'privileged_tools_require_explicit_approval',
        normalized,
        privilegedTools,
      );
    }

    return {
      allowed: true,
      effectiveTools: requestedTools,
      privilegedTools,
      rationale: this.buildSuccessRationale(normalized, privilegedTools),
    };
  }

  private normalizeInput(
    params: EvaluateMeshDelegationPolicyParams,
  ): NormalizedGovernanceInput {
    return {
      targetAgentProfile: params.targetAgentProfile.trim(),
      requestedTools: normalizeStringList(params.requestedTools),
      allowedTools: normalizeStringList(params.allowedTools ?? []),
      deniedTools: normalizeStringList(params.deniedTools ?? []),
      tokenBudget: normalizeOptionalInteger(params.tokenBudget),
      timeBudgetMs: normalizeOptionalInteger(params.timeBudgetMs),
      maxRetries: normalizeNonNegativeInteger(params.maxRetries ?? 0, 0),
      queuePriority: normalizePositiveInteger(params.queuePriority ?? 100, 100),
      allowPrivilegedTools: params.allowPrivilegedTools === true,
    };
  }

  private async validateBudgetConstraints(
    params: NormalizedGovernanceInput,
  ): Promise<MeshDelegationDenialReason | null> {
    const retryDenial = this.resolveRetryDenial(params.maxRetries);
    if (retryDenial) {
      return retryDenial;
    }

    const queuePriorityDenial = this.resolveQueuePriorityDenial(
      params.queuePriority,
    );
    if (queuePriorityDenial) {
      return queuePriorityDenial;
    }

    const maxTokenBudget = await this.systemSettings.get<number>(
      'agent_mesh_max_token_budget',
      DEFAULT_MAX_TOKEN_BUDGET,
    );
    const tokenBudgetDenial = this.resolveTokenBudgetDenial(
      params.tokenBudget,
      maxTokenBudget,
    );
    if (tokenBudgetDenial) {
      return tokenBudgetDenial;
    }

    const maxTimeBudgetMs = await this.systemSettings.get<number>(
      'agent_mesh_max_time_budget_ms',
      DEFAULT_MAX_TIME_BUDGET_MS,
    );
    return this.resolveTimeBudgetDenial(params.timeBudgetMs, maxTimeBudgetMs);
  }

  private resolveTokenBudgetDenial(
    tokenBudget: number | null,
    maxTokenBudget: number,
  ): MeshDelegationDenialReason | null {
    if (tokenBudget === null) {
      return null;
    }

    if (tokenBudget <= 0 || tokenBudget > maxTokenBudget) {
      return 'token_budget_out_of_range';
    }

    return null;
  }

  private resolveTimeBudgetDenial(
    timeBudgetMs: number | null,
    maxTimeBudgetMs: number,
  ): MeshDelegationDenialReason | null {
    if (timeBudgetMs === null) {
      return null;
    }

    if (timeBudgetMs <= 0 || timeBudgetMs > maxTimeBudgetMs) {
      return 'time_budget_out_of_range';
    }

    return null;
  }

  private resolveRetryDenial(
    maxRetries: number,
  ): MeshDelegationDenialReason | null {
    if (maxRetries < MIN_RETRY_ATTEMPTS || maxRetries > MAX_RETRY_ATTEMPTS) {
      return 'max_retries_out_of_range';
    }

    return null;
  }

  private resolveQueuePriorityDenial(
    queuePriority: number,
  ): MeshDelegationDenialReason | null {
    if (
      queuePriority < MIN_QUEUE_PRIORITY ||
      queuePriority > MAX_QUEUE_PRIORITY
    ) {
      return 'queue_priority_out_of_range';
    }

    return null;
  }

  private async resolvePrivilegedToolIntersection(
    requestedTools: string[],
  ): Promise<string[]> {
    const configuredPrivilegedTools = await this.systemSettings.get<string[]>(
      'agent_mesh_privileged_tools',
      [...DEFAULT_PRIVILEGED_TOOLS],
    );

    const privilegedSet = new Set(
      normalizeStringList(configuredPrivilegedTools),
    );
    return requestedTools.filter((toolName) => privilegedSet.has(toolName));
  }

  private buildDeniedDecision(
    denialReason: MeshDelegationDenialReason,
    params: NormalizedGovernanceInput,
    implicatedTools: string[],
  ): MeshDelegationGovernanceDecision {
    return {
      allowed: false,
      denialReason,
      effectiveTools: [],
      privilegedTools: [],
      rationale: this.buildDeniedRationale(
        denialReason,
        params,
        implicatedTools,
      ),
    };
  }

  private buildDeniedRationale(
    denialReason: MeshDelegationDenialReason,
    params: NormalizedGovernanceInput,
    implicatedTools: string[],
  ): string[] {
    const details =
      implicatedTools.length > 0 ? implicatedTools.join(', ') : 'none';
    return [
      `governance_denial_reason:${denialReason}`,
      `target_agent_profile:${params.targetAgentProfile}`,
      `requested_tools:${params.requestedTools.join(', ') || 'none'}`,
      `implicated_tools:${details}`,
    ];
  }

  private buildSuccessRationale(
    params: NormalizedGovernanceInput,
    privilegedTools: string[],
  ): string[] {
    return [
      `target_agent_profile:${params.targetAgentProfile}`,
      `effective_tools:${params.requestedTools.join(', ')}`,
      `privileged_tools:${privilegedTools.join(', ') || 'none'}`,
      `queue_priority:${params.queuePriority.toString()}`,
      `max_retries:${params.maxRetries.toString()}`,
    ];
  }
}

function resolveAllowedToolViolation(
  requestedTools: string[],
  allowedTools: string[],
): string | null {
  if (allowedTools.length === 0) {
    return null;
  }

  const allowedSet = new Set(allowedTools);
  const invalidTool = requestedTools.find(
    (toolName) => !allowedSet.has(toolName),
  );
  return invalidTool ?? null;
}

function resolveDeniedToolIntersection(
  requestedTools: string[],
  deniedTools: string[],
): string[] {
  if (deniedTools.length === 0) {
    return [];
  }

  const deniedSet = new Set(deniedTools);
  return requestedTools.filter((toolName) => deniedSet.has(toolName));
}

function resolveUnauthorizedTargetProfileTools(params: {
  targetAgentProfile: string;
  requestedTools: string[];
  evaluateAccess: (profileName: string, toolName: string) => boolean;
}): string[] {
  return params.requestedTools.filter(
    (toolName) => !params.evaluateAccess(params.targetAgentProfile, toolName),
  );
}

function normalizeOptionalInteger(
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isInteger(value)) {
    return null;
  }

  return value;
}

function normalizeNonNegativeInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function normalizePositiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeStringList(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [...new Set(normalized)];
}
