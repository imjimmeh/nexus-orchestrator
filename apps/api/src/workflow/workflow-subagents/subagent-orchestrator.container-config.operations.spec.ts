import {
  CLAUDE_CODE_CAPABILITIES,
  ContainerTier,
  CONTAINER_EXTENSIONS_PATH,
  CONTAINER_SESSION_PATH,
  PI_CAPABILITIES,
  type HarnessId,
} from '@nexus/core';
import * as jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { buildSubagentContainerConfigOperation } from './subagent-orchestrator.container-config.operations';
import { MEMORY_CAPTURE_GUIDANCE } from '../workflow-step-execution/step-support-memory-capture.helpers';
import type { SubagentContainerConfigContext } from './subagent-orchestrator.operations.types';

function buildContext(
  overrides: Partial<SubagentContainerConfigContext> = {},
): SubagentContainerConfigContext {
  return {
    jwtSecret: 'test-secret',
    aiConfig: {
      resolveStepSettings: vi.fn().mockResolvedValue({
        model: 'gpt-test',
        providerName: 'openai',
        systemPrompt: 'You are a test agent.',
      }),
      resolveRunnerProviderConfig: vi.fn().mockResolvedValue({
        provider: 'openai',
        apiKey: 'test-api-key',
        auth: { type: 'api_key', apiKey: 'test-api-key' },
        baseUrl: 'https://example.invalid/v1',
      }),
      listSkillCategories: vi.fn(() => []),
      getAgentProfileByName: vi.fn().mockResolvedValue(null),
      getModelDefaultThinkingLevel: vi.fn().mockResolvedValue(null),
    },
    runnerConfigStore: {
      store: vi.fn().mockResolvedValue(undefined),
    },
    toolMounting: {
      writeSdkToolAllowlist: vi.fn(),
      // Default: all tools allowed — individual tests can override for deny scenarios
      canProfileUseTool: vi.fn().mockReturnValue(true),
    },
    registry: {
      validateForStep: vi.fn((id: HarnessId) => ({ harnessId: id })),
      resolve: vi.fn((id: HarnessId) => ({
        capabilities:
          id === 'claude-code' ? CLAUDE_CODE_CAPABILITIES : PI_CAPABILITIES,
        defaultEnv: id === 'claude-code' ? { DISABLE_AUTOUPDATER: '1' } : {},
      })),
    },
    scopedDefaults: {
      resolve: vi.fn().mockResolvedValue({}),
    },
    support: {
      buildPromotedLearningContext: vi.fn().mockResolvedValue(''),
      assembleAgentSystemPrompt: vi
        .fn()
        .mockImplementation(
          async (ctx: { baseLayers: Array<{ id: string; content: string }> }) =>
            ctx.baseLayers
              .map((l) => l.content)
              .filter(Boolean)
              .join('\n\n'),
        ),
    },
    // Node-only fast path: resolver returns the base default (no
    // toolchains), image resolver echoes the base image ref unchanged,
    // cache service adds nothing — mirrors the real node-only behavior
    // these tests pin down. Tests exercising the non-node-only path
    // override these via `overrides`.
    resolver: {
      resolve: vi.fn().mockResolvedValue({ toolchains: [] }),
    },
    imageResolver: {
      resolveImageRef: vi
        .fn()
        .mockImplementation(
          async (params: { baseImageRef: string }) => params.baseImageRef,
        ),
    },
    cacheService: {
      resolveCacheMounts: vi.fn().mockResolvedValue({ volumes: [], env: {} }),
    },
    workflowRepo: {
      findById: vi.fn().mockResolvedValue(null),
    },
    logger: {
      warn: vi.fn(),
    },
    ...overrides,
  };
}

describe('buildSubagentContainerConfigOperation', () => {
  it('resolves subagent container tier from spawn params', async () => {
    const context = buildContext();

    const { config } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'light',
        workflowRunId: 'run-1',
      },
    });

    expect(config.tier).toBe(ContainerTier.LIGHT);
    expect(config.image).toBe('nexus-light:latest');
    expect(config.labels?.['nexus.tier']).toBe(ContainerTier.LIGHT);
  });

  it('respects heavy tier when explicitly requested in spawn params', async () => {
    const context = buildContext();

    const { config } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
    });

    expect(config.tier).toBe(ContainerTier.HEAVY);
    expect(config.image).toBe('nexus-heavy:latest');
    expect(config.labels?.['nexus.tier']).toBe(ContainerTier.HEAVY);
  });

  it('defaults to HEAVY when no spawn tier is provided and no parent tier is available', async () => {
    const context = buildContext();

    const { config } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature',
        tools: ['read'],
        workflowRunId: 'run-1',
        // tier intentionally omitted
      },
    });

    expect(config.tier).toBe(ContainerTier.HEAVY);
    expect(config.image).toBe('nexus-heavy:latest');
  });

  it('inherits parent step tier when no spawn tier is provided', async () => {
    const context = buildContext();

    const { config } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature',
        tools: ['read'],
        workflowRunId: 'run-1',
        // tier intentionally omitted — should inherit from parentTier
      },
      parentTier: ContainerTier.LIGHT,
    });

    expect(config.tier).toBe(ContainerTier.LIGHT);
    expect(config.image).toBe('nexus-light:latest');
    expect(config.labels?.['nexus.tier']).toBe(ContainerTier.LIGHT);
  });

  it('spawn tier takes precedence over parent step tier', async () => {
    const context = buildContext();

    const { config } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'light',
        workflowRunId: 'run-1',
      },
      // parent is HEAVY but spawn explicitly requests LIGHT
      parentTier: ContainerTier.HEAVY,
    });

    expect(config.tier).toBe(ContainerTier.LIGHT);
    expect(config.image).toBe('nexus-light:latest');
  });

  it('sets job context to subagent execution ID and preserves parent linkage', async () => {
    const context = buildContext();

    const { config } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'subagent-exec-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'investigation-subagent',
        task_prompt: 'Investigate codebase',
        tools: ['bash', 'read', 'ls', 'find', 'grep'],
        tier: 'heavy',
        workflowRunId: 'run-1',
        parent_job_id: 'run_scope_probes',
      },
    });

    expect(config.env!['JOB_ID']).toBe('subagent-exec-1');
    expect(config.labels?.['nexus.job_id']).toBe('subagent-exec-1');

    const decoded = jwt.verify(
      config.env!['AGENT_JWT'],
      'test-secret',
    ) as Record<string, unknown>;
    expect(decoded.jobId).toBe('subagent-exec-1');
    expect(decoded.parent_job_id).toBe('run_scope_probes');
    expect(decoded.isSubagent).toBe(true);
    expect(decoded.workflowRunId).toBe('run-1');
    expect(decoded.agentProfileName).toBe('investigation-subagent');
    expect(decoded.subagentExecutionId).toBe('subagent-exec-1');
    expect(decoded.allowedTools).toEqual([
      'bash',
      'read',
      'ls',
      'find',
      'grep',
    ]);
  });

  it('points EXTENSIONS_PATH at the same path the subagent tool mount is bound to', async () => {
    const context = buildContext();

    const { config } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'subagent-exec-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'investigation-subagent',
        task_prompt: 'Investigate codebase',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
    });

    const toolVolume = config.volumes?.find(
      (v) => v.containerPath === CONTAINER_EXTENSIONS_PATH,
    );
    expect(toolVolume).toBeDefined();
    expect(config.env!['EXTENSIONS_PATH']).toBe(CONTAINER_EXTENSIONS_PATH);
  });

  it('sets SESSION_PATH so the subagent session is extractable by the API', async () => {
    const context = buildContext();

    const { config } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'subagent-exec-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'investigation-subagent',
        task_prompt: 'Investigate codebase',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
    });

    expect(config.env!['SESSION_PATH']).toBe(CONTAINER_SESSION_PATH);
  });

  it('passes runtime context to SDK allowlist writer when building subagent config', async () => {
    const context = buildContext();

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'subagent-exec-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'investigation-subagent',
        task_prompt: 'Investigate codebase',
        tools: ['bash', 'read', 'ls', 'find', 'grep'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
    });

    expect(context.toolMounting.writeSdkToolAllowlist).toHaveBeenCalledWith(
      expect.any(String),
      ['bash', 'read', 'ls', 'find', 'grep'],
      {
        workflowRunId: 'run-1',
        jobId: 'subagent-exec-1',
        stepId: 'subagent-exec-1',
      },
    );
  });

  it('injects assigned-skill content into the pi subagent prompt (native mode)', async () => {
    const context = buildContext();

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      assignedSkills: [
        {
          name: 'test-driven-development',
          description: 'Write tests first',
          skillMarkdown: 'Red, green, refactor.',
        },
      ],
    });

    const stored = (context.runnerConfigStore.store as ReturnType<typeof vi.fn>)
      .mock.calls[0][2] as { prompt: { systemPrompt: string } };
    expect(stored.prompt.systemPrompt).toContain(
      '<skill name="test-driven-development">',
    );
    expect(stored.prompt.systemPrompt).toContain('Red, green, refactor.');
    expect(stored.prompt.systemPrompt).not.toContain('search_skills');
  });

  it('injects assigned-skill content into the claude-code subagent prompt (native mode)', async () => {
    const context = buildContext({
      scopedDefaults: {
        resolve: vi.fn().mockResolvedValue({
          harnessId: 'claude-code',
          modelName: 'claude-sonnet-4-6',
          providerName: 'anthropic-claude-code',
        }),
      },
    });

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      scopeNodeId: 'scope-1',
      assignedSkills: [
        {
          name: 'test-driven-development',
          description: 'Write tests first',
          skillMarkdown: 'Red, green, refactor.',
        },
      ],
    });

    const stored = (context.runnerConfigStore.store as ReturnType<typeof vi.fn>)
      .mock.calls[0][2] as { prompt: { systemPrompt: string } };
    expect(stored.prompt.systemPrompt).toContain(
      '<skill name="test-driven-development">',
    );
    expect(stored.prompt.systemPrompt).toContain('Red, green, refactor.');
  });

  it('passes executionContext through to resolveRunnerProviderConfig', async () => {
    const context = buildContext();

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'light',
        workflowRunId: 'run-1',
      },
      executionContext: { ownerType: 'scope', ownerId: 'scope-1' },
    });

    expect(context.aiConfig.resolveRunnerProviderConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: { ownerType: 'scope', ownerId: 'scope-1' },
      }),
    );
  });

  it('passes raw war-room tools through the SDK allowlist', async () => {
    const context = buildContext();

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'architect-agent',
        task_prompt: 'Review feature',
        tools: [
          'read',
          'ls',
          'post_war_room_message',
          'submit_war_room_signoff',
          'get_war_room_state',
        ],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
    });

    expect(context.toolMounting.writeSdkToolAllowlist).toHaveBeenCalledWith(
      expect.any(String),
      [
        'read',
        'ls',
        'post_war_room_message',
        'submit_war_room_signoff',
        'get_war_room_state',
      ],
      {
        workflowRunId: 'run-1',
        jobId: 'execution-1',
        stepId: 'execution-1',
      },
    );
  });
});

describe('buildSubagentContainerConfigOperation — runtime toolchain provisioning (non-node-only path)', () => {
  it('threads a non-node toolchain resolution into a composite image and cache mounts on the subagent container config', async () => {
    const COMPOSITE_IMAGE_REF = 'nexus-rt/pi:abc123def456';
    const CACHE_VOLUME = {
      hostPath: 'nexus-cache-pip',
      containerPath: '/root/.cache/pip',
      readOnly: false,
    };
    const CACHE_ENV = { PIP_CACHE_DIR: '/root/.cache/pip' };

    const resolve = vi
      .fn()
      .mockResolvedValue({ toolchains: [{ tool: 'python', version: '3.12' }] });
    const resolveImageRef = vi.fn().mockResolvedValue(COMPOSITE_IMAGE_REF);
    const resolveCacheMounts = vi.fn().mockResolvedValue({
      volumes: [CACHE_VOLUME],
      env: CACHE_ENV,
    });

    const context = buildContext({
      resolver: { resolve },
      imageResolver: { resolveImageRef },
      cacheService: { resolveCacheMounts },
    });

    const { config } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'subagent-exec-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      workspacePath: '/data/worktrees/project-1/item-1',
    });

    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: '/data/worktrees/project-1/item-1',
      }),
    );
    expect(config.image).toBe(COMPOSITE_IMAGE_REF);
    expect(config.image).not.toBe('nexus-heavy:latest');
    expect(config.volumes).toContainEqual(CACHE_VOLUME);
    expect(config.env).toEqual(expect.objectContaining(CACHE_ENV));
  });

  it('threads the loaded agent profile toolchain config into the resolver as agentProfileConfig', async () => {
    const resolve = vi
      .fn()
      .mockResolvedValue({ toolchains: [{ tool: 'rust', version: '1.80' }] });

    const context = buildContext({
      aiConfig: {
        resolveStepSettings: vi.fn().mockResolvedValue({
          model: 'gpt-test',
          providerName: 'openai',
          systemPrompt: 'You are a test agent.',
        }),
        resolveRunnerProviderConfig: vi.fn().mockResolvedValue({
          provider: 'openai',
          apiKey: 'test-api-key',
          auth: { type: 'api_key', apiKey: 'test-api-key' },
          baseUrl: 'https://example.invalid/v1',
        }),
        listSkillCategories: vi.fn(() => []),
        // The Task 13/18 agent-profile toolchain layer (runtime_toolchains
        // on AgentProfile) must reach the resolver so the UI-editable
        // profile layer actually takes effect at runtime.
        getAgentProfileByName: vi.fn().mockResolvedValue({
          name: 'rust-agent',
          runtime_toolchains: {
            toolchains: [{ tool: 'rust', version: '1.80' }],
          },
        }),
        getModelDefaultThinkingLevel: vi.fn().mockResolvedValue(null),
      },
      resolver: { resolve },
    });

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'subagent-exec-2',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'rust-agent',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
    });

    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileConfig: { toolchains: [{ tool: 'rust', version: '1.80' }] },
      }),
    );
  });
});

describe('buildSubagentContainerConfigOperation harness inheritance', () => {
  it('inherits the scoped claude-code harness instead of hardcoding pi', async () => {
    const context = buildContext({
      aiConfig: {
        resolveStepSettings: vi.fn().mockResolvedValue({
          model: 'claude-sonnet-4-6',
          providerName: 'anthropic-claude-code',
          systemPrompt: 'You are a subagent.',
        }),
        resolveRunnerProviderConfig: vi.fn().mockResolvedValue({
          provider: 'anthropic-claude-code',
          auth: { type: 'oauth', token: 'oauth-token' },
          baseUrl: undefined,
        }),
        listSkillCategories: vi.fn(() => []),
        getAgentProfileByName: vi.fn().mockResolvedValue(null),
        getModelDefaultThinkingLevel: vi.fn().mockResolvedValue(null),
      },
      scopedDefaults: {
        resolve: vi.fn().mockResolvedValue({
          harnessId: 'claude-code',
          modelName: 'claude-sonnet-4-6',
          providerName: 'anthropic-claude-code',
        }),
      },
    });

    const { runtime } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Fix tests',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      scopeNodeId: 'scope-1',
      executionContext: { ownerType: 'scope', ownerId: 'scope-1' },
    });

    expect(context.scopedDefaults.resolve).toHaveBeenCalledWith('scope-1');
    expect(runtime.harnessId).toBe('claude-code');
    expect(context.runnerConfigStore.store).toHaveBeenCalledWith(
      'run-1',
      'execution-1',
      expect.objectContaining({
        harnessId: 'claude-code',
        model: expect.objectContaining({ provider: 'anthropic-claude-code' }),
      }),
    );
  });

  it('applies the scoped provider/model as explicit overrides into resolveStepSettings', async () => {
    const context = buildContext({
      scopedDefaults: {
        resolve: vi.fn().mockResolvedValue({
          harnessId: 'claude-code',
          modelName: 'claude-sonnet-4-6',
          providerName: 'anthropic-claude-code',
        }),
      },
    });

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Fix tests',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      scopeNodeId: 'scope-1',
    });

    expect(context.aiConfig.resolveStepSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        explicitModel: 'claude-sonnet-4-6',
        explicitProviderName: 'anthropic-claude-code',
      }),
    );
  });

  it('honours an explicit spawn override ahead of the scoped default', async () => {
    const context = buildContext({
      scopedDefaults: {
        resolve: vi.fn().mockResolvedValue({
          harnessId: 'claude-code',
          modelName: 'claude-sonnet-4-6',
          providerName: 'anthropic-claude-code',
        }),
      },
    });

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Fix tests',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
        model_override: 'gpt-5',
        provider_override: 'openai',
      },
      scopeNodeId: 'scope-1',
    });

    expect(context.aiConfig.resolveStepSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        explicitModel: 'gpt-5',
        explicitProviderName: 'openai',
      }),
    );
  });

  it('falls back to the pi harness when no scoped default exists (back-compat)', async () => {
    const context = buildContext();

    const { runtime } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      scopeNodeId: 'scope-1',
    });

    expect(runtime.harnessId).toBe('pi');
    expect(context.runnerConfigStore.store).toHaveBeenCalledWith(
      'run-1',
      'execution-1',
      expect.objectContaining({ harnessId: 'pi' }),
    );
  });
});

describe('buildSubagentContainerConfigOperation — thinking level', () => {
  function buildThinkingContext(
    resolve: ReturnType<typeof vi.fn>,
    modelDefault: string | null,
  ): SubagentContainerConfigContext {
    return buildContext({
      aiConfig: {
        resolveStepSettings: vi.fn().mockResolvedValue({
          model: 'kimi-for-coding',
          providerName: 'moonshot',
          systemPrompt: 'You are a subagent.',
        }),
        resolveRunnerProviderConfig: vi.fn().mockResolvedValue({
          provider: 'moonshot',
          auth: { type: 'api_key', apiKey: 'test-api-key' },
          baseUrl: 'https://example.invalid/v1',
        }),
        listSkillCategories: vi.fn(() => []),
        getAgentProfileByName: vi.fn().mockResolvedValue(null),
        getModelDefaultThinkingLevel: vi.fn().mockResolvedValue(modelDefault),
      },
      thinkingLevelResolver: {
        resolve,
      } as SubagentContainerConfigContext['thinkingLevelResolver'],
    });
  }

  it('resolves the model-default thinking level and stamps it onto the runner config', async () => {
    const resolve = vi.fn().mockResolvedValue({ level: 'high' });
    const context = buildThinkingContext(resolve, 'high');

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
    });

    // Subagents have no step-input layer: precedence is agent profile -> model
    // default, and the pi harness supports thinking levels.
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        stepInput: undefined,
        modelDefault: 'high',
        modelId: 'kimi-for-coding',
        harnessSupportsThinkingLevels: true,
      }),
    );

    const stored = (context.runnerConfigStore.store as ReturnType<typeof vi.fn>)
      .mock.calls[0][2] as { model: { thinkingLevel?: string } };
    expect(stored.model.thinkingLevel).toBe('high');
  });

  it('leaves thinkingLevel unset when the resolver drops it (harness unsupported)', async () => {
    const resolve = vi.fn().mockResolvedValue({ dropped: true });
    const context = buildContext({
      aiConfig: {
        resolveStepSettings: vi.fn().mockResolvedValue({
          model: 'claude-sonnet-4-6',
          providerName: 'anthropic-claude-code',
          systemPrompt: 'You are a subagent.',
        }),
        resolveRunnerProviderConfig: vi.fn().mockResolvedValue({
          provider: 'anthropic-claude-code',
          auth: { type: 'oauth', token: 'oauth-token' },
          baseUrl: undefined,
        }),
        listSkillCategories: vi.fn(() => []),
        getAgentProfileByName: vi.fn().mockResolvedValue(null),
        getModelDefaultThinkingLevel: vi.fn().mockResolvedValue('high'),
      },
      scopedDefaults: {
        resolve: vi.fn().mockResolvedValue({
          harnessId: 'claude-code',
          modelName: 'claude-sonnet-4-6',
          providerName: 'anthropic-claude-code',
        }),
      },
      thinkingLevelResolver: {
        resolve,
      },
    });

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Fix tests',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      scopeNodeId: 'scope-1',
    });

    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ harnessSupportsThinkingLevels: false }),
    );

    const stored = (context.runnerConfigStore.store as ReturnType<typeof vi.fn>)
      .mock.calls[0][2] as { model: { thinkingLevel?: string } };
    expect(stored.model.thinkingLevel).toBeUndefined();
  });
});

describe('buildSubagentContainerConfigOperation — AGENT_JWT lifetime', () => {
  const spawnParams = {
    agent_profile: 'architect-agent',
    task_prompt: 'Implement feature',
    tools: ['read'],
    tier: 'heavy' as const,
    workflowRunId: 'run-1',
  };

  it('mints the subagent AGENT_JWT with the default 24h TTL', async () => {
    const { config } = await buildSubagentContainerConfigOperation(
      buildContext(),
      {
        executionId: 'execution-1',
        parentContainerId: 'parent-container-1',
        spawnParams,
      },
    );
    const decoded = jwt.verify(config.env!['AGENT_JWT'], 'test-secret') as {
      iat: number;
      exp: number;
    };
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(86_400 - 5);
  });

  it('honours AGENT_JWT_TTL', async () => {
    const previous = process.env['AGENT_JWT_TTL'];
    process.env['AGENT_JWT_TTL'] = '1h';
    try {
      const { config } = await buildSubagentContainerConfigOperation(
        buildContext(),
        {
          executionId: 'execution-1',
          parentContainerId: 'parent-container-1',
          spawnParams,
        },
      );
      const decoded = jwt.verify(config.env!['AGENT_JWT'], 'test-secret') as {
        iat: number;
        exp: number;
      };
      expect(decoded.exp - decoded.iat).toBe(3_600);
    } finally {
      if (previous === undefined) delete process.env['AGENT_JWT_TTL'];
      else process.env['AGENT_JWT_TTL'] = previous;
    }
  });
});

describe('buildSubagentContainerConfigOperation — memory-capture guidance', () => {
  it('includes MEMORY_CAPTURE_GUIDANCE in the subagent system prompt for a normal workflow', async () => {
    const context = buildContext();

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      workflowId: 'implement-and-commit-default',
    });

    const stored = (context.runnerConfigStore.store as ReturnType<typeof vi.fn>)
      .mock.calls[0][2] as { prompt: { systemPrompt: string } };
    expect(stored.prompt.systemPrompt).toContain(MEMORY_CAPTURE_GUIDANCE);
  });

  it('omits MEMORY_CAPTURE_GUIDANCE for suppressed workflow memory_learning_sweep', async () => {
    const context = buildContext();

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Run memory sweep',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      workflowId: 'memory_learning_sweep',
    });

    const stored = (context.runnerConfigStore.store as ReturnType<typeof vi.fn>)
      .mock.calls[0][2] as { prompt: { systemPrompt: string } };
    expect(stored.prompt.systemPrompt).not.toContain(MEMORY_CAPTURE_GUIDANCE);
  });

  it('omits MEMORY_CAPTURE_GUIDANCE for suppressed workflow project_orchestration_cycle_ceo', async () => {
    const context = buildContext();

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Run CEO cycle',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      workflowId: 'project_orchestration_cycle_ceo',
    });
    const stored = (context.runnerConfigStore.store as ReturnType<typeof vi.fn>)
      .mock.calls[0][2] as { prompt: { systemPrompt: string } };
    expect(stored.prompt.systemPrompt).not.toContain(MEMORY_CAPTURE_GUIDANCE);
  });

  it('includes MEMORY_CAPTURE_GUIDANCE when workflowId is absent (no suppression)', async () => {
    const context = buildContext();

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
    });

    const stored = (context.runnerConfigStore.store as ReturnType<typeof vi.fn>)
      .mock.calls[0][2] as { prompt: { systemPrompt: string } };
    expect(stored.prompt.systemPrompt).toContain(MEMORY_CAPTURE_GUIDANCE);
  });
});

describe('buildSubagentContainerConfigOperation — profileAllowed ∩ requestedTools intersection', () => {
  it('excludes a profile-denied tool from writeSdkToolAllowlist and AGENT_JWT allowedTools', async () => {
    const context = buildContext({
      toolMounting: {
        writeSdkToolAllowlist: vi.fn(),
        // profile denies spawn_subagent_async
        canProfileUseTool: vi
          .fn()
          .mockImplementation(
            (_profile: string, tool: string) => tool !== 'spawn_subagent_async',
          ),
      },
    });

    const { config } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'limited-agent',
        task_prompt: 'Implement feature',
        tools: ['read', 'spawn_subagent_async'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
    });

    expect(context.toolMounting.writeSdkToolAllowlist).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.arrayContaining(['spawn_subagent_async']),
      expect.any(Object),
    );

    const decoded = jwt.verify(config.env!['AGENT_JWT'], 'test-secret') as {
      allowedTools: string[];
    };
    expect(decoded.allowedTools).not.toContain('spawn_subagent_async');
    expect(decoded.allowedTools).toContain('read');
  });

  it('preserves wait_for_subagents as a companion when spawn_subagent_async is granted', async () => {
    const context = buildContext({
      toolMounting: {
        writeSdkToolAllowlist: vi.fn(),
        // profile allows spawn_subagent_async but not wait_for_subagents explicitly
        canProfileUseTool: vi
          .fn()
          .mockImplementation(
            (_profile: string, tool: string) => tool !== 'wait_for_subagents',
          ),
      },
    });

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'orchestrator-agent',
        task_prompt: 'Orchestrate work',
        tools: ['read', 'spawn_subagent_async', 'wait_for_subagents'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
    });

    expect(context.toolMounting.writeSdkToolAllowlist).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['spawn_subagent_async', 'wait_for_subagents']),
      expect.any(Object),
    );
  });

  it('passes all tools through when agent_profile is an empty string (no profile)', async () => {
    const context = buildContext();

    // SubagentSpawnParams requires agent_profile: string, but the intersection
    // guard treats any falsy value as "no profile". Cast to exercise that path.
    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: '',
        task_prompt: 'Anonymous task',
        tools: ['read', 'spawn_subagent_async'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
    });

    expect(context.toolMounting.canProfileUseTool).not.toHaveBeenCalled();
    expect(context.toolMounting.writeSdkToolAllowlist).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['read', 'spawn_subagent_async']),
      expect.any(Object),
    );
  });
});

describe('buildSubagentContainerConfigOperation — HARNESS_ID + harnessDefaultEnv', () => {
  it('sets HARNESS_ID env var to runtime.harnessId', async () => {
    const context = buildContext();

    const { config } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
    });

    // pi harness is the default fallback when no scoped default is configured
    expect(config.env!['HARNESS_ID']).toBe('pi');
  });

  it('spreads harnessDefaultEnv keys into env for claude-code harness', async () => {
    const context = buildContext({
      scopedDefaults: {
        resolve: vi.fn().mockResolvedValue({
          harnessId: 'claude-code',
          modelName: 'claude-sonnet-4-6',
          providerName: 'anthropic-claude-code',
        }),
      },
      aiConfig: {
        resolveStepSettings: vi.fn().mockResolvedValue({
          model: 'claude-sonnet-4-6',
          providerName: 'anthropic-claude-code',
          systemPrompt: 'You are a subagent.',
        }),
        resolveRunnerProviderConfig: vi.fn().mockResolvedValue({
          provider: 'anthropic-claude-code',
          auth: { type: 'oauth', token: 'oauth-token' },
          baseUrl: undefined,
        }),
        listSkillCategories: vi.fn(() => []),
        getAgentProfileByName: vi.fn().mockResolvedValue(null),
        getModelDefaultThinkingLevel: vi.fn().mockResolvedValue(null),
      },
    });

    const { config } = await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Fix tests',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      scopeNodeId: 'scope-1',
    });

    // claude-code defaultEnv carries DISABLE_AUTOUPDATER: '1' per the mock
    expect(config.env!['DISABLE_AUTOUPDATER']).toBe('1');
    expect(config.env!['HARNESS_ID']).toBe('claude-code');
  });
});

describe('buildSubagentContainerConfigOperation — workflowName threading (FU-8)', () => {
  it('resolves workflowName via workflowRepo and forwards it to buildPromotedLearningContext', async () => {
    const workflowFindById = vi.fn().mockResolvedValue({
      id: 'wf-uuid',
      name: 'implementation_pipeline',
    });
    const buildPromotedLearningContext = vi.fn().mockResolvedValue('');
    const context = buildContext({
      workflowRepo: { findById: workflowFindById },
      support: {
        buildPromotedLearningContext,
        assembleAgentSystemPrompt: vi
          .fn()
          .mockImplementation(
            async (ctx: {
              baseLayers: Array<{ id: string; content: string }>;
            }) =>
              ctx.baseLayers
                .map((l) => l.content)
                .filter(Boolean)
                .join('\n\n'),
          ),
      },
    });

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      workflowId: 'wf-uuid',
    });

    expect(workflowFindById).toHaveBeenCalledWith('wf-uuid');
    expect(buildPromotedLearningContext).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'implementation_pipeline' }),
    );
  });

  it('omits workflowName (no lookup, no throw) when the spawn has no workflowId', async () => {
    const workflowFindById = vi.fn().mockResolvedValue(null);
    const buildPromotedLearningContext = vi.fn().mockResolvedValue('');
    const context = buildContext({
      workflowRepo: { findById: workflowFindById },
      support: {
        buildPromotedLearningContext,
        assembleAgentSystemPrompt: vi.fn().mockResolvedValue(''),
      },
    });

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      // workflowId intentionally omitted
    });

    expect(workflowFindById).not.toHaveBeenCalled();
    const callArgs = buildPromotedLearningContext.mock.calls[0][0] as {
      workflowName?: string;
    };
    expect(callArgs.workflowName).toBeUndefined();
  });

  it('resolves undefined and logs a warning (no throw) when workflowRepo.findById rejects', async () => {
    const workflowFindById = vi
      .fn()
      .mockRejectedValue(new Error('db unavailable'));
    const warn = vi.fn();
    const buildPromotedLearningContext = vi.fn().mockResolvedValue('');
    const context = buildContext({
      workflowRepo: { findById: workflowFindById },
      logger: { warn },
      support: {
        buildPromotedLearningContext,
        assembleAgentSystemPrompt: vi.fn().mockResolvedValue(''),
      },
    });

    await buildSubagentContainerConfigOperation(context, {
      executionId: 'execution-1',
      parentContainerId: 'parent-container-1',
      spawnParams: {
        agent_profile: 'senior_dev',
        task_prompt: 'Implement feature',
        tools: ['read'],
        tier: 'heavy',
        workflowRunId: 'run-1',
      },
      workflowId: 'wf-uuid',
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to resolve workflow name'),
    );
    const callArgs = buildPromotedLearningContext.mock.calls[0][0] as {
      workflowName?: string;
    };
    expect(callArgs.workflowName).toBeUndefined();
  });
});
