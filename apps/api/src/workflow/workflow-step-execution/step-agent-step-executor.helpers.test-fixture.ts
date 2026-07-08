import { vi } from 'vitest';
import type { JobQueueData } from './step-execution.types';
import type { IWorkflowEngineService } from '../kernel/interfaces/workflow-kernel.ports';
import type { StepRequiredToolRetryService } from './step-required-tool-retry.service';
import type { HarnessRegistryLike } from './step-agent-step-executor.helpers.types';
import { HarnessProviderRegistryService } from '../../harness/harness-provider-registry.service';
import {
  CLAUDE_CODE_CAPABILITIES,
  PI_CAPABILITIES,
  type HarnessId,
} from '@nexus/core';
import type { buildStepRunnerConfigPayloadCore } from './step-agent-step-executor.helpers';

export const mockRegistry: HarnessRegistryLike = {
  validateForStep: (id) => ({ harnessId: id }),
  resolve: (harnessId) => ({
    capabilities:
      harnessId === 'claude-code' ? CLAUDE_CODE_CAPABILITIES : PI_CAPABILITIES,
  }),
};

export function makeSupportMock(overrides = {}) {
  return {
    resolveAgentProfileFromJobInputs: vi.fn(() => undefined),
    buildUpstreamContextForJob: vi.fn().mockResolvedValue(''),
    buildRunningWorkflowsContext: vi.fn().mockResolvedValue(''),
    buildPromotedLearningContext: vi.fn().mockResolvedValue(''),
    assembleAgentSystemPrompt: vi.fn(
      (ctx: { baseLayers: Array<{ content: string }> }) =>
        Promise.resolve(
          ctx.baseLayers
            .map((l) => l.content)
            .filter(Boolean)
            .join('\n'),
        ),
    ),
    ...overrides,
  } as never;
}

export function makeAiConfig({
  model = 'test-model',
  providerName = 'test-provider',
  systemPrompt = 'Base prompt.',
  apiKey = 'test-key',
}: {
  model?: string;
  providerName?: string;
  systemPrompt?: string;
  apiKey?: string;
} = {}) {
  const provider =
    providerName === 'anthropic-claude-code'
      ? 'anthropic-claude-code'
      : 'openai';
  return {
    resolveStepSettings: vi.fn().mockResolvedValue({
      model,
      providerName,
      systemPrompt,
    }),
    resolveRunnerProviderConfig: vi.fn().mockResolvedValue({
      provider,
      apiKey,
      auth: { type: 'api_key' as const, apiKey },
      baseUrl: undefined,
    }),
    getAgentProfileByName: vi.fn().mockResolvedValue(null),
    getModelDefaultThinkingLevel: vi.fn().mockResolvedValue(null),
  };
}

export const makeOpenAiConfig = (
  overrides: Parameters<typeof makeAiConfig>[0] = {},
) =>
  makeAiConfig({
    model: 'gpt-4o',
    providerName: 'openai',
    systemPrompt: 'You are a Pi Agent.',
    ...overrides,
  });

export const makeClaudeConfig = (
  overrides: Parameters<typeof makeAiConfig>[0] = {},
) =>
  makeAiConfig({
    model: 'claude-opus-4',
    providerName: 'anthropic-claude-code',
    systemPrompt: 'sys',
    ...overrides,
  });

export const claudeAiConfig = makeClaudeConfig();

export function makeRegistry(
  capabilities: typeof PI_CAPABILITIES = PI_CAPABILITIES,
): HarnessRegistryLike {
  return {
    validateForStep: vi.fn((id: HarnessId) => ({ harnessId: id })),
    resolve: vi.fn(() => ({ capabilities })),
  };
}

export function makeCorePayloadParams(
  overrides: Record<string, unknown> = {},
): Parameters<typeof buildStepRunnerConfigPayloadCore>[0] {
  const harnessId = (overrides.harnessId as string) ?? 'generic';
  const {
    data,
    step,
    resolvedJobInputs,
    harnessId: _,
    support,
    stateManager,
    aiConfig,
    registry,
    ...rest
  } = overrides;
  return {
    data: {
      job: { id: 'test-job', inputs: { harness_id: harnessId } },
      userMessage: undefined,
      workflowRunId: 'run-test',
      ...(data ?? {}),
    },
    step: { id: 'test-step', type: 'agent', ...(step ?? {}) },
    resolvedJobInputs: { harness_id: harnessId, ...(resolvedJobInputs ?? {}) },
    stateVariables: overrides.stateVariables ?? {},
    support: (support ?? makeSupportMock()) as never,
    stateManager: (stateManager ?? {
      substituteTemplate: vi.fn((value: string) => value),
    }) as never,
    aiConfig: (aiConfig ?? makeAiConfig()) as never,
    registry: (registry ?? mockRegistry) as never,
    assignedSkills: overrides.assignedSkills,
    availableCategories: overrides.availableCategories,
    skillDiscoveryMode: overrides.skillDiscoveryMode,
    credentialResolver: overrides.credentialResolver,
    scopeNodeId: overrides.scopeNodeId,
    scopedDefaults: overrides.scopedDefaults,
    ledger: overrides.ledger,
    thinkingLevelResolver: overrides.thinkingLevelResolver,
    ...rest,
  } as unknown as Parameters<typeof buildStepRunnerConfigPayloadCore>[0];
}

export const resumeBase = (
  data: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) => {
  const { resolvedJobInputs, ...rest } = overrides;
  return makeCorePayloadParams({
    data: {
      job: { id: 'impl', inputs: {} },
      workflowRunId: 'run-resume',
      userMessage: undefined,
      ...data,
    },
    step: { id: 'resume_step', type: 'agent' },
    resolvedJobInputs: { harness_id: undefined, ...(resolvedJobInputs ?? {}) },
    ...rest,
  });
};

export function makeJobQueueData(
  overrides: Partial<JobQueueData> = {},
): JobQueueData {
  return {
    workflowRunId: 'run-1',
    jobId: 'implement_and_commit',
    job: { id: 'implement_and_commit', type: 'execution' } as never,
    workflowPermissions: { allow_tools: ['read'] } as never,
    workflowSkillDiscoveryMode: 'native',
    workflowYamlSkills: ['git-commit-discipline'],
    ...overrides,
  };
}

export const makeEngine = () =>
  ({
    retryJobWithMessage: vi.fn().mockResolvedValue(undefined),
  }) as unknown as IWorkflowEngineService;

export const makeRequiredToolRetry = (result: 'retried' | 'proceed') =>
  ({
    checkRequiredToolCallsAndRetryJob: vi.fn().mockResolvedValue(result),
  }) as unknown as StepRequiredToolRetryService;

export const makeRealRegistry = () => new HarnessProviderRegistryService();
