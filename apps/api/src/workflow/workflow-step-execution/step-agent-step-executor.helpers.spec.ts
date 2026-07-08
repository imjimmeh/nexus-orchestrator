import { describe, expect, it, vi } from 'vitest';
import {
  buildRunnerSessionConfig,
  buildStepRunnerConfigPayloadCore,
  checkRequiredToolRetryForJobCore,
  resolveStepAiSettings,
  resolveStepHarness,
  retryJobCarryingWorkflowSkillsCore,
} from './step-agent-step-executor.helpers';
import {
  CLAUDE_CODE_CAPABILITIES,
  PI_CAPABILITIES,
  type HarnessId,
} from '@nexus/core';
import {
  claudeAiConfig,
  makeAiConfig,
  makeClaudeConfig,
  makeCorePayloadParams,
  makeEngine,
  makeJobQueueData,
  makeOpenAiConfig,
  makeRealRegistry,
  makeRegistry,
  makeRequiredToolRetry,
  makeSupportMock,
  mockRegistry,
  resumeBase,
} from './step-agent-step-executor.helpers.test-fixture';

describe('resolveStepAiSettings', () => {
  it('prefers step input overrides over scoped defaults', async () => {
    const aiConfig = makeAiConfig();
    await resolveStepAiSettings(
      aiConfig as never,
      {
        explicitModel: 'step-model',
        explicitProvider: 'step-provider',
        explicitSystemPrompt: 'step-prompt',
      },
      { modelName: 'scoped-model', providerName: 'scoped-provider' },
      { id: 's1', type: 'agent' },
      'profile-name',
    );
    expect(aiConfig.resolveStepSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        explicitModel: 'step-model',
        explicitProviderName: 'step-provider',
        explicitSystemPrompt: 'step-prompt',
        agentProfileName: 'profile-name',
      }),
    );
  });

  it('falls back to scoped defaults when step overrides are absent', async () => {
    const aiConfig = makeAiConfig();
    await resolveStepAiSettings(
      aiConfig as never,
      {},
      { modelName: 'scoped-model', providerName: 'scoped-provider' },
      { id: 's1', type: 'agent' },
    );
    expect(aiConfig.resolveStepSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        explicitModel: 'scoped-model',
        explicitProviderName: 'scoped-provider',
      }),
    );
  });
});

describe('resolveStepHarness', () => {
  it('selects harness from step override', async () => {
    const result = await resolveStepHarness(
      makeRegistry(PI_CAPABILITIES),
      { harness_id: 'pi' },
      { harnessId: 'claude-code' },
      { provider: 'openai' } as never,
      { model: 'gpt-4o' } as never,
      { resolveRunnerProviderConfig: vi.fn() } as never,
    );
    expect(result.harnessId).toBe('pi');
  });

  it('selects harness from scoped default', async () => {
    const result = await resolveStepHarness(
      makeRegistry(CLAUDE_CODE_CAPABILITIES),
      {},
      { harnessId: 'claude-code' },
      { provider: 'anthropic-claude-code' } as never,
      { model: 'claude-opus-4' } as never,
      { resolveRunnerProviderConfig: vi.fn() } as never,
    );
    expect(result.harnessId).toBe('claude-code');
  });

  it('falls back to platform harness when scoped provider is incompatible', async () => {
    const resolveRunnerProviderConfig = vi.fn(async () => ({
      provider: 'anthropic-claude-code',
      auth: { type: 'api_key' as const, apiKey: 'key' },
    }));
    const ledger = { emitBestEffort: vi.fn(async () => undefined) };
    const result = await resolveStepHarness(
      makeRegistry(CLAUDE_CODE_CAPABILITIES),
      {},
      { harnessId: 'claude-code' },
      { provider: 'openai' } as never,
      { model: 'gpt-4o' } as never,
      { resolveRunnerProviderConfig } as never,
      'scope-a',
      ledger,
    );
    expect(result.harnessId).toBe('pi');
    expect(resolveRunnerProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({ providerName: 'anthropic-claude-code' }),
    );
    expect(ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'harness.selection.fallback' }),
    );
  });
});

describe('buildStepRunnerConfigPayloadCore skill guidance', () => {
  it('does not direct runtime agents to nonexistent filesystem tools for skills', async () => {
    const payload = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        resolvedJobInputs: { agent_profile: 'ceo-agent' },
        assignedSkills: [
          {
            id: 'project-analysis',
            name: 'project-analysis',
            description: 'Analyze project state.',
          },
        ],
        availableCategories: ['orchestration'],
        skillDiscoveryMode: 'search',
      }),
    );
    expect(payload.prompt.systemPrompt).toContain('Use `search_skills`');
    expect(payload.prompt.systemPrompt).not.toContain('/root/.pi/agent/skills');
    expect(payload.prompt.systemPrompt).not.toContain('SKILL.md');
    expect(payload.prompt.systemPrompt).toContain('Do not call `read_file`');
  });

  it('native mode injects full skill content inline and omits search guidance', async () => {
    const payload = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        resolvedJobInputs: { agent_profile: 'ceo-agent' },
        assignedSkills: [
          {
            id: 'project-analysis',
            name: 'project-analysis',
            description: 'Analyze project state.',
            skillMarkdown: 'Break down the project into phases.',
          },
        ],
        availableCategories: ['orchestration'],
        skillDiscoveryMode: 'native',
      }),
    );
    expect(payload.prompt.systemPrompt).toContain(
      '<skill name="project-analysis">',
    );
    expect(payload.prompt.systemPrompt).toContain(
      'Break down the project into phases.',
    );
    expect(payload.prompt.systemPrompt).not.toContain('search_skills');
    expect(payload.prompt.systemPrompt).not.toContain('read_skill_manifest');
  });

  it('search mode with pi harness produces no injected skill content and no skill section', async () => {
    const payload = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        harnessId: 'pi',
        assignedSkills: [
          {
            id: 'project-analysis',
            name: 'project-analysis',
            description: 'Analyze project state.',
            skillMarkdown: 'Break down the project into phases.',
          },
        ],
        availableCategories: ['orchestration'],
        skillDiscoveryMode: 'search',
      }),
    );
    const prompt = payload.prompt.systemPrompt;
    expect(prompt).toContain('Base prompt.');
    expect(prompt).not.toContain('<skill');
    expect(prompt).not.toContain('search_skills');
  });

  it('injects assigned skill content inline for pi/claude-code in native mode', async () => {
    for (const harnessId of ['pi', 'claude-code']) {
      const payload = await buildStepRunnerConfigPayloadCore(
        makeCorePayloadParams({
          harnessId,
          assignedSkills: [
            {
              id: 'debugging',
              name: 'debugging',
              description: 'find bugs',
              skillMarkdown: 'Systematic isolation steps.',
            },
          ],
          availableCategories: ['orchestration'],
          skillDiscoveryMode: 'native',
          ...(harnessId === 'claude-code' && {
            aiConfig: makeClaudeConfig({ systemPrompt: 'Base prompt.' }),
          }),
        }),
      );
      expect(payload.prompt.systemPrompt).toContain('<skill name="debugging">');
      expect(payload.prompt.systemPrompt).toContain(
        'Systematic isolation steps.',
      );
      expect(payload.prompt.systemPrompt).not.toContain('read_skill_manifest');
    }
  });
});

describe('buildStepRunnerConfigPayloadCore runtime context', () => {
  it('injects workflow and scope context into prompts when trigger context is available', async () => {
    const payload = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        harnessId: 'pi',
        data: {
          job: { id: 'refine_charter', inputs: {} },
          workflowRunId: 'run-context',
        },
        step: { id: 'refine', type: 'agent' },
        stateVariables: {
          trigger: {
            context: {
              scopeId: 'scope-123',
              contextId: 'context-456',
              contextType: 'project',
            },
          },
        },
        registry: makeRealRegistry(),
        aiConfig: makeOpenAiConfig({ systemPrompt: 'Base prompt.' }),
      }),
    );
    expect(payload.prompt.systemPrompt).toContain('Workflow runtime context:');
    expect(payload.prompt.systemPrompt).toContain(
      '- workflowRunId: run-context',
    );
    expect(payload.prompt.systemPrompt).toContain('- jobId: refine_charter');
    expect(payload.prompt.systemPrompt).toContain('- stepId: refine');
    expect(payload.prompt.systemPrompt).toContain('- scopeId: scope-123');
    expect(payload.prompt.systemPrompt).toContain('- contextId: context-456');
  });
});

describe('buildStepRunnerConfigPayloadCore promoted learning injection', () => {
  it('injects the promoted learning section into the system prompt', async () => {
    const buildPromotedLearningContext = vi.fn(async () =>
      [
        '## Prior promoted lessons',
        '',
        'The following lessons were promoted from prior workflows in this scope. Use them to inform your plan, but verify they still apply before acting on them.',
        '',
        '1. Cite evidence before mutating workflow behavior.  (confidence: 0.85, source: learning_candidate)',
      ].join('\n'),
    );
    const payload = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        data: { job: { id: 'refine_charter', inputs: {} } },
        step: {
          id: 'refine',
          type: 'agent',
          prompt: 'Refine the project charter',
        },
        support: makeSupportMock({ buildPromotedLearningContext }),
      }),
    );
    expect(buildPromotedLearningContext).toHaveBeenCalledWith({
      workflowRunId: 'run-test',
      stateVariables: undefined,
      query: 'Refine the project charter',
    });
    expect(payload.prompt.systemPrompt).toContain('## Prior promoted lessons');
    expect(payload.prompt.systemPrompt).toContain(
      '1. Cite evidence before mutating workflow behavior.',
    );
  });

  it('omits the query argument when the step has no prompt', async () => {
    const buildPromotedLearningContext = vi.fn(async () => '');
    const payload = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        data: { job: { id: 'impl', inputs: {} } },
        step: { id: 'impl_step', type: 'agent' },
        support: makeSupportMock({ buildPromotedLearningContext }),
      }),
    );
    expect(buildPromotedLearningContext).toHaveBeenCalledWith({
      workflowRunId: 'run-test',
      stateVariables: undefined,
    });
    expect(payload.prompt.systemPrompt).not.toContain(
      '## Prior promoted lessons',
    );
  });
});

describe('buildStepRunnerConfigPayloadCore harness selection', () => {
  it('sets harnessId from step inputs harness_id override', async () => {
    const payload = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        harnessId: 'claude-code',
        resolvedJobInputs: { harness_id: 'claude-code' },
        aiConfig: makeClaudeConfig({
          systemPrompt: 'You are a helpful assistant.',
        }),
      }),
    );
    expect(payload.harnessId).toBe('claude-code');
    expect(payload.model.provider).toBe('anthropic-claude-code');
    expect(payload.model.model).toBe('claude-opus-4');
    expect(payload.prompt.systemPrompt).toContain(
      'You are a helpful assistant.',
    );
  });

  it('defaults to pi harness when no harness_id is provided', async () => {
    const payload = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        resolvedJobInputs: { harness_id: undefined },
        aiConfig: makeOpenAiConfig(),
      }),
    );
    expect(payload.harnessId).toBe('pi');
  });
});

describe('buildStepRunnerConfigPayloadCore credential resolution', () => {
  it('overrides model.auth with the resolved primary credential and populates harnessOptions.credentials', async () => {
    const credentialResolver = {
      resolvePrimaryAuth: vi.fn(async () => ({
        type: 'api_key' as const,
        apiKey: 'BOUND-SECRET',
      })),
      resolveAll: vi.fn(
        async () =>
          ({
            extra: {
              key: 'extra',
              authType: 'api_key' as const,
              auth: { type: 'api_key' as const, apiKey: 'EXTRA' },
            },
          }) as never,
      ),
    };
    const payload = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        harnessId: 'claude-code',
        resolvedJobInputs: { harness_id: 'claude-code' },
        aiConfig: {
          ...makeClaudeConfig(),
          resolveRunnerProviderConfig: vi.fn(async () => ({
            provider: 'anthropic-claude-code',
            auth: { type: 'api_key', apiKey: '' },
            baseUrl: undefined,
          })),
        },
        credentialResolver,
        scopeNodeId: 'scope-leaf',
      }),
    );
    expect(credentialResolver.resolvePrimaryAuth).toHaveBeenCalledWith({
      harnessId: 'claude-code',
      scopeNodeId: 'scope-leaf',
      providerAuth: { type: 'api_key', apiKey: '' },
    });
    expect(payload.model.auth).toEqual({
      type: 'api_key',
      apiKey: 'BOUND-SECRET',
    });
    expect(payload.harnessOptions?.credentials).toEqual({
      extra: {
        key: 'extra',
        authType: 'api_key',
        auth: { type: 'api_key', apiKey: 'EXTRA' },
      },
    });
  });

  it('leaves model.auth as the provider auth when no credentialResolver is supplied', async () => {
    const payload = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        aiConfig: {
          ...makeOpenAiConfig({ systemPrompt: 'sys' }),
          resolveRunnerProviderConfig: vi.fn(async () => ({
            provider: 'openai',
            auth: { type: 'api_key', apiKey: 'PROVIDER' },
            baseUrl: undefined,
          })),
        },
      }),
    );
    expect(payload.model.auth).toEqual({ type: 'api_key', apiKey: 'PROVIDER' });
    expect(payload.harnessOptions).toBeUndefined();
  });
});

describe('buildStepRunnerConfigPayloadCore scoped defaults + compatibility', () => {
  it('selects the harness from the scoped default when no step override is present', async () => {
    const scopedDefaults = {
      resolve: vi.fn(async () => ({
        harnessId: 'claude-code',
        providerName: 'anthropic',
      })),
    };
    const registry = {
      validateForStep: vi.fn((id: HarnessId) => ({ harnessId: id })),
      resolve: vi.fn(() => ({ capabilities: CLAUDE_CODE_CAPABILITIES })),
    };
    const result = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        resolvedJobInputs: { harness_id: undefined },
        aiConfig: makeClaudeConfig(),
        registry,
        scopeNodeId: 'scope-a',
        scopedDefaults,
      }),
    );
    expect(scopedDefaults.resolve).toHaveBeenCalledWith('scope-a');
    expect(result.harnessId).toBe('claude-code');
  });

  it('falls back to the platform harness when the scoped provider is incompatible', async () => {
    const scopedDefaults = {
      resolve: vi.fn(async () => ({
        harnessId: 'claude-code',
        providerName: 'openai',
      })),
    };
    const ledger = { emitBestEffort: vi.fn(async () => undefined) };
    const resolveRunnerProviderConfig = vi.fn(
      async ({ providerName }: { providerName?: string }) => ({
        provider: providerName ?? 'anthropic',
        auth: { type: 'api_key' as const, apiKey: 'key' },
        baseUrl: undefined,
      }),
    );
    const result = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        resolvedJobInputs: { harness_id: undefined },
        aiConfig: {
          ...makeOpenAiConfig({ systemPrompt: 'sys' }),
          resolveRunnerProviderConfig,
        },
        registry: mockRegistry,
        scopeNodeId: 'scope-a',
        scopedDefaults,
        ledger,
      }),
    );
    expect(result.harnessId).toBe('pi');
    expect(ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'harness.selection.fallback' }),
    );
  });

  it('a step harness override beats the scoped default', async () => {
    const scopedDefaults = {
      resolve: vi.fn(async () => ({ harnessId: 'claude-code' })),
    };
    const registry = {
      validateForStep: vi.fn((id: HarnessId) => ({ harnessId: id })),
      resolve: vi.fn(() => ({ capabilities: PI_CAPABILITIES })),
    };
    const result = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        harnessId: 'pi',
        resolvedJobInputs: { harness_id: 'pi' },
        registry,
        scopeNodeId: 'scope-a',
        scopedDefaults,
      }),
    );
    expect(result.harnessId).toBe('pi');
  });
});

describe('buildRunnerSessionConfig', () => {
  it('populates session.resume when resumeMechanism is config_ref', () => {
    const result = buildRunnerSessionConfig({
      resumeSessionRef: { kind: 'claude_code', sessionId: 's1' },
      resumeMechanism: 'config_ref',
    });
    expect(result).toEqual({
      resume: { kind: 'claude_code', sessionId: 's1' },
    });
  });

  it('does not populate session.resume when resumeMechanism is file_injection', () => {
    const result = buildRunnerSessionConfig({
      resumeSessionRef: { kind: 'pi', treeId: 't1', resumeNodeId: 'n1' },
      resumeMechanism: 'file_injection',
    });
    expect(result).toBeUndefined();
  });

  it('populates session.resume for custom harness with config_ref mechanism', () => {
    // Intentionally bypass closed HarnessSessionRef union to probe future extensibility.
    const result = buildRunnerSessionConfig({
      resumeSessionRef: { kind: 'custom:my-harness', sessionId: 's2' } as any,
      resumeMechanism: 'config_ref',
    });
    expect(result).toEqual({
      resume: { kind: 'custom:my-harness', sessionId: 's2' },
    });
  });

  it('returns undefined when resumeSessionRef is undefined', () => {
    const result = buildRunnerSessionConfig({
      resumeSessionRef: undefined,
      resumeMechanism: 'config_ref',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when resumeMechanism is undefined', () => {
    const result = buildRunnerSessionConfig({
      resumeSessionRef: { kind: 'claude_code', sessionId: 's1' },
      resumeMechanism: undefined as never,
    });
    expect(result).toBeUndefined();
  });
});

describe('buildStepRunnerConfigPayloadCore session resume', () => {
  it('wires a claude_code resume ref into config.session.resume', async () => {
    const payload = await buildStepRunnerConfigPayloadCore(
      resumeBase(
        { resumeSessionRef: { kind: 'claude_code', sessionId: 's-prior' } },
        {
          resolvedJobInputs: { harness_id: 'claude-code' },
          aiConfig: claudeAiConfig,
        },
      ),
    );
    expect(payload.session?.resume).toEqual({
      kind: 'claude_code',
      sessionId: 's-prior',
    });
  });

  it('on a claude_code resume, the user-turn prompt is ONLY the join message', async () => {
    const join =
      'Your awaited workflows finished: child-1 COMPLETED. Continue.';
    const payload = await buildStepRunnerConfigPayloadCore(
      resumeBase({
        resumeSessionRef: { kind: 'claude_code', sessionId: 's-prior' },
        userMessage: join,
      }),
    );
    expect(payload.prompt.initialPrompt).toBe(join);
    expect(payload.prompt.initialPrompt).not.toContain(
      payload.prompt.systemPrompt,
    );
  });

  it('on a fresh start, the user-turn prompt is the full system prompt', async () => {
    const payload = await buildStepRunnerConfigPayloadCore(resumeBase());
    expect(payload.prompt.initialPrompt).toBe(payload.prompt.systemPrompt);
  });

  it('on a pi resume, the user-turn prompt is ONLY the join message', async () => {
    const join = 'Your awaited workflows finished. Continue.';
    const payload = await buildStepRunnerConfigPayloadCore(
      resumeBase({
        resumeSessionRef: { kind: 'pi', treeId: 'tree-1' },
        userMessage: join,
      }),
    );
    expect(payload.prompt.initialPrompt).toBe(join);
    expect(payload.prompt.initialPrompt).not.toContain(
      payload.prompt.systemPrompt,
    );
  });

  it('on a plain retry, the user-turn prompt keeps the full system prompt + retry message', async () => {
    const retry = 'Previous attempt failed; try again.';
    const payload = await buildStepRunnerConfigPayloadCore(
      resumeBase({ userMessage: retry }),
    );
    expect(payload.prompt.initialPrompt).toContain(payload.prompt.systemPrompt);
    expect(payload.prompt.initialPrompt).toContain(retry);
  });

  it('leaves session unset when no resume ref is present', async () => {
    const payload = await buildStepRunnerConfigPayloadCore(resumeBase());
    expect(payload.session).toBeUndefined();
  });

  it('does not populate session.resume for a pi resume ref', async () => {
    const payload = await buildStepRunnerConfigPayloadCore(
      resumeBase({ resumeSessionRef: { kind: 'pi', treeId: 'tree-1' } }),
    );
    expect(payload.session).toBeUndefined();
  });

  it('handles registry without resolve method gracefully', async () => {
    const registry = {
      validateForStep: vi.fn((id) => ({ harnessId: id })),
    } as never;
    const payload = await buildStepRunnerConfigPayloadCore(
      resumeBase(
        { resumeSessionRef: { kind: 'claude_code', sessionId: 's-r' } },
        { resolvedJobInputs: { harness_id: 'claude-code' }, registry },
      ),
    );
    expect(payload.session).toBeUndefined();
  });

  it('handles capabilities missing resumeMechanism gracefully', async () => {
    const registry = {
      validateForStep: vi.fn((id) => ({ harnessId: id })),
      resolve: vi.fn(() => ({ capabilities: {} }) as never),
    };
    const payload = await buildStepRunnerConfigPayloadCore(
      resumeBase(
        { resumeSessionRef: { kind: 'claude_code', sessionId: 's-r' } },
        {
          resolvedJobInputs: { harness_id: 'claude-code' },
          registry,
          aiConfig: claudeAiConfig,
        },
      ),
    );
    expect(payload.session).toBeUndefined();
  });

  it('does not populate session.resume when claude_code resume ref but harness is pi', async () => {
    const payload = await buildStepRunnerConfigPayloadCore(
      resumeBase(
        { resumeSessionRef: { kind: 'claude_code', sessionId: 's-r' } },
        {
          resolvedJobInputs: { harness_id: 'pi' },
          registry: {
            validateForStep: mockRegistry.validateForStep,
            resolve: vi.fn((id: string) => ({
              capabilities:
                id === 'pi' ? PI_CAPABILITIES : CLAUDE_CODE_CAPABILITIES,
            })),
          },
        },
      ),
    );
    expect(payload.session).toBeUndefined();
  });
});

describe('buildAgentSystemPrompt assembly integration', () => {
  it('runs the assembly pipeline for pi/claude-code harnesses (no early return)', async () => {
    const assembleSpy = vi.fn().mockResolvedValue('ASSEMBLED');
    const support = makeSupportMock({ assembleAgentSystemPrompt: assembleSpy });
    const config = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({ support, harnessId: 'pi' }),
    );
    expect(assembleSpy).toHaveBeenCalledTimes(1);
    expect(assembleSpy.mock.calls[0][0]).toMatchObject({ harnessId: 'pi' });
    expect(config.prompt.systemPrompt).toContain('ASSEMBLED');
  });

  it('omits the skill section for harness agents but still assembles', async () => {
    const assembleSpy = vi.fn().mockResolvedValue('ASSEMBLED');
    const support = makeSupportMock({ assembleAgentSystemPrompt: assembleSpy });
    await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({ support, harnessId: 'claude-code' }),
    );
    const baseLayers = assembleSpy.mock.calls[0][0].baseLayers as Array<{
      id: string;
    }>;
    expect(baseLayers.map((l) => l.id)).not.toContain('skill');
  });
});

describe('buildStepRunnerConfigPayloadCore thinkingLevel', () => {
  it('sets model.thinkingLevel from step input when supported', async () => {
    const config = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        resolvedJobInputs: { harness_id: 'generic', thinking_level: 'high' },
        thinkingLevelResolver: { resolve: async () => ({ level: 'high' }) },
      }),
    );
    expect(config.model.thinkingLevel).toBe('high');
  });

  it('leaves model.thinkingLevel undefined when resolver returns dropped', async () => {
    const config = await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        resolvedJobInputs: { harness_id: 'generic', thinking_level: 'high' },
        thinkingLevelResolver: { resolve: async () => ({ dropped: true }) },
      }),
    );
    expect(config.model.thinkingLevel).toBeUndefined();
  });

  it('emits telemetry when the level is clamped', async () => {
    const ledger = { emitBestEffort: vi.fn() };
    await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        resolvedJobInputs: { harness_id: 'generic', thinking_level: 'xhigh' },
        thinkingLevelResolver: {
          resolve: async () => ({ level: 'high', clampedFrom: 'xhigh' }),
        },
        ledger,
      }),
    );
    expect(ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ event_name: 'thinking_level.adjusted' }),
    );
  });

  it('passes agent profile thinking_level to resolver', async () => {
    const resolverSpy = vi.fn(async () => ({ level: 'medium' as const }));
    const params = makeCorePayloadParams({
      support: makeSupportMock({
        resolveAgentProfileFromJobInputs: vi.fn(() => 'thinking-agent'),
      }),
    });
    await buildStepRunnerConfigPayloadCore({
      ...params,
      aiConfig: {
        ...params.aiConfig,
        getAgentProfileByName: vi.fn(async () => ({
          thinking_level: 'medium',
        })),
        getModelDefaultThinkingLevel: vi.fn(async () => null),
      } as never,
      resolvedJobInputs: { harness_id: 'generic' },
      thinkingLevelResolver: { resolve: resolverSpy },
    });
    expect(resolverSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agentProfile: 'medium' }),
    );
  });

  it('passes model default_thinking_level to resolver', async () => {
    const resolverSpy = vi.fn(async () => ({ level: 'low' as const }));
    const params = makeCorePayloadParams();
    await buildStepRunnerConfigPayloadCore({
      ...params,
      aiConfig: {
        ...params.aiConfig,
        getModelDefaultThinkingLevel: vi.fn(async () => 'low'),
      } as never,
      resolvedJobInputs: { harness_id: 'generic' },
      thinkingLevelResolver: { resolve: resolverSpy },
    });
    expect(resolverSpy).toHaveBeenCalledWith(
      expect.objectContaining({ modelDefault: 'low' }),
    );
  });

  it('uses actual step input as requested in dropped telemetry', async () => {
    const ledger = { emitBestEffort: vi.fn() };
    await buildStepRunnerConfigPayloadCore(
      makeCorePayloadParams({
        resolvedJobInputs: { harness_id: 'generic', thinking_level: 'high' },
        thinkingLevelResolver: { resolve: async () => ({ dropped: true }) },
        ledger,
      }),
    );
    expect(ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: 'thinking_level.adjusted',
        requested: 'high',
        effective: '(omitted)',
      }),
    );
  });
});

describe('retryJobCarryingWorkflowSkillsCore', () => {
  it('carries workflowYamlSkills (and siblings) from the job data into the retry', async () => {
    const workflowEngine = makeEngine();
    const data = makeJobQueueData();
    await retryJobCarryingWorkflowSkillsCore(workflowEngine, data, {
      runId: 'run-1',
      failedJobId: 'implement_and_commit',
      retryPrompt: 'retry the job',
    });
    expect(workflowEngine.retryJobWithMessage).toHaveBeenCalledWith(
      'run-1',
      'implement_and_commit',
      data.job,
      undefined,
      'retry the job',
      { allow_tools: ['read'] },
      'native',
      ['git-commit-discipline'],
    );
  });

  it('passes undefined skills through undefined-safely when the job data has none', async () => {
    const workflowEngine = makeEngine();
    const data = makeJobQueueData({
      workflowYamlSkills: undefined,
      workflowPermissions: undefined,
      workflowSkillDiscoveryMode: undefined,
    });
    await retryJobCarryingWorkflowSkillsCore(workflowEngine, data, {
      runId: 'run-1',
      failedJobId: 'implement_and_commit',
      retryPrompt: 'retry the job',
    });
    expect(workflowEngine.retryJobWithMessage).toHaveBeenCalledWith(
      'run-1',
      'implement_and_commit',
      data.job,
      undefined,
      'retry the job',
      undefined,
      undefined,
      undefined,
    );
  });
});

describe('checkRequiredToolRetryForJobCore', () => {
  it('carries workflowYamlSkills (and siblings) from the job data into the retry check', async () => {
    const requiredToolRetry = makeRequiredToolRetry('retried');
    const data = makeJobQueueData();
    const result = await checkRequiredToolRetryForJobCore(
      requiredToolRetry,
      {
        workflowRunId: 'run-1',
        jobId: 'implement_and_commit',
        job: data.job,
        data,
      },
      'container-1',
    );
    expect(result).toBe('retried');
    expect(
      requiredToolRetry.checkRequiredToolCallsAndRetryJob,
    ).toHaveBeenCalledWith(
      'run-1',
      'implement_and_commit',
      data.job,
      'container-1',
      { allow_tools: ['read'] },
      'native',
      ['git-commit-discipline'],
    );
  });

  it('passes undefined skills through undefined-safely when the job data has none', async () => {
    const requiredToolRetry = makeRequiredToolRetry('proceed');
    const data = makeJobQueueData({
      workflowYamlSkills: undefined,
      workflowPermissions: undefined,
      workflowSkillDiscoveryMode: undefined,
    });
    const result = await checkRequiredToolRetryForJobCore(
      requiredToolRetry,
      {
        workflowRunId: 'run-1',
        jobId: 'implement_and_commit',
        job: data.job,
        data,
      },
      'container-1',
    );
    expect(result).toBe('proceed');
    expect(
      requiredToolRetry.checkRequiredToolCallsAndRetryJob,
    ).toHaveBeenCalledWith(
      'run-1',
      'implement_and_commit',
      data.job,
      'container-1',
      undefined,
      undefined,
      undefined,
    );
  });
});
