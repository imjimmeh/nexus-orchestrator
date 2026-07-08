import { describe, expect, it, vi } from 'vitest';
import { PI_CAPABILITIES } from '@nexus/core';
import type { SubagentExecutionView } from './subagent-execution-view.types';
import type { SubagentSpawnOperationsContext } from './subagent-orchestrator.operations.types';
import { scheduleSubagentExecutionKickoff } from './subagent-orchestrator.kickoff-execution.operations';
import { spawnSubagentAsyncOperation } from './subagent-orchestrator.spawn.operations';

vi.mock('./subagent-orchestrator.kickoff-execution.operations', () => ({
  scheduleSubagentExecutionKickoff: vi.fn(),
}));

function buildSpawnContext(): SubagentSpawnOperationsContext {
  return {
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    } as never,
    jwtSecret: 'test-secret',
    subagentReadModel: {
      findByParentContainerId: vi.fn().mockResolvedValue([]),
      findByChildContainerId: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
    } as never,
    subagentDetailsRepo: {
      upsert: vi.fn().mockResolvedValue(undefined),
    } as never,
    chatSessionRepo: {
      findByContainerId: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'subagent-chat-session-1' }),
      update: vi.fn().mockResolvedValue(null),
    } as never,
    subagentChatSessionPort: {
      createSubagentChatSession: vi
        .fn()
        .mockResolvedValue('subagent-chat-session-1'),
    },
    containerOrchestrator: {
      provisionContainer: vi.fn().mockResolvedValue('child-container-1'),
      getContainerHostMountBindings: vi.fn().mockResolvedValue([]),
    } as never,
    runRepo: {
      findById: vi.fn().mockResolvedValue({
        id: 'workflow-run-1',
        state_variables: {
          trigger: {
            scopeId: 'project-scope-1',
            repositoryUrl: 'https://github.com/org/repo',
          },
        },
      }),
    } as never,
    aiConfig: {
      resolveStepSettings: vi.fn().mockResolvedValue({
        model: 'test-model',
        providerName: 'test-provider',
        systemPrompt: 'test system prompt',
      }),
      resolveRunnerProviderConfig: vi.fn().mockResolvedValue({
        provider: 'test-provider',
        apiKey: 'test-api-key',
        auth: { type: 'api_key', apiKey: 'test-api-key' },
        baseUrl: 'https://provider.example.test',
      }),
      listSkillCategories: vi.fn(() => []),
      getAgentProfileByName: vi.fn().mockResolvedValue(null),
    } as never,
    stageSkillPolicy: {
      resolveAssignedSkills: vi.fn().mockResolvedValue({ skills: [] }),
    } as never,
    workflowRepo: {
      findById: vi.fn().mockResolvedValue(null),
    },
    workflowSkillBindings: {
      listForWorkflow: vi.fn().mockResolvedValue([]),
    },
    skillCatalog: {
      listSkills: vi.fn().mockReturnValue([]),
    },
    runnerConfigStore: {
      store: vi.fn().mockResolvedValue(undefined),
    } as never,
    containerHttpClient: {} as never,
    systemSettings: {
      get: vi.fn().mockResolvedValue(3),
    } as never,
    skillMounting: {
      prepareSkillMount: vi.fn().mockReturnValue(null),
      cleanupSkillMount: vi.fn(),
    } as never,
    toolMounting: {
      writeSdkToolAllowlist: vi.fn(),
      writeNexusActionAllowlist: vi.fn(),
    } as never,
    hostMountResolution: {
      resolveHostMountBindings: vi.fn().mockResolvedValue([]),
    } as never,
    agentProfileRepo: {
      findByName: vi.fn().mockResolvedValue({
        id: 'agent-profile-1',
        name: 'general',
      }),
      findAll: vi.fn().mockResolvedValue([]),
    } as never,
    gitWorktreeService: {
      resolveProjectBasePath: vi
        .fn()
        .mockResolvedValue('/data/repos/project-scope-1'),
    } as never,
    registry: {
      validateForStep: vi.fn((id: string) => ({ harnessId: id })),
      resolve: vi.fn(() => ({ capabilities: PI_CAPABILITIES })),
    },
    scopedDefaults: {
      resolve: vi.fn().mockResolvedValue({}),
    },
    // Node-only fast path: resolver returns the base default (no
    // toolchains), image resolver echoes the base image ref unchanged,
    // cache service adds nothing.
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
    resolveContainerIpAddress: vi.fn().mockResolvedValue('127.0.0.1'),
    emitSubagentLifecycleEvent: vi.fn().mockResolvedValue(undefined),
    resolveErrorMessage: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
    runParentContainerExclusive: async <T>(
      _parentContainerId: string,
      task: () => Promise<T>,
    ): Promise<T> => task(),
    executionEvents: {
      created: vi.fn().mockResolvedValue(undefined),
      provisioning: vi.fn().mockResolvedValue(undefined),
      provisioned: vi.fn().mockResolvedValue(undefined),
      running: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
      cancelled: vi.fn().mockResolvedValue(undefined),
    } as never,
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
  };
}

describe('spawnSubagentAsyncOperation', () => {
  it('mounts the project base path when the workflow run trigger only has scopeId', async () => {
    const context = buildSpawnContext();

    await spawnSubagentAsyncOperation(context, 'parent-container-1', {
      agent_profile: 'general',
      task_prompt: 'Inspect the project',
      tools: [],
      tier: 'heavy',
      workflowRunId: 'workflow-run-1',
      inherit_host_mounts: false,
    });

    await vi.waitFor(() => {
      expect(
        context.gitWorktreeService.resolveProjectBasePath,
      ).toHaveBeenCalledWith('project-scope-1');
    });
    expect(
      context.containerOrchestrator.provisionContainer,
    ).toHaveBeenCalledWith(
      expect.any(Object),
      true,
      true,
      '/data/repos/project-scope-1',
    );
  });

  it('rejects with structured concurrency limit error when max concurrent subagents reached', async () => {
    const context = buildSpawnContext();
    const activeExecutions = [
      {
        id: 'active-1',
        status: 'Running',
        assigned_files: [],
        parent_container_id: 'parent-container-1',
        depth: 1,
        created_at: new Date(),
      } as SubagentExecutionView,
      {
        id: 'active-2',
        status: 'Running',
        assigned_files: [],
        parent_container_id: 'parent-container-1',
        depth: 1,
        created_at: new Date(),
      } as SubagentExecutionView,
      {
        id: 'active-3',
        status: 'Running',
        assigned_files: [],
        parent_container_id: 'parent-container-1',
        depth: 1,
        created_at: new Date(),
      } as SubagentExecutionView,
    ];
    vi.mocked(
      context.subagentReadModel.findByParentContainerId,
    ).mockResolvedValue(activeExecutions);

    await expect(
      spawnSubagentAsyncOperation(context, 'parent-container-1', {
        agent_profile: 'general',
        task_prompt: 'Test task',
        tools: [],
        tier: 'heavy',
        workflowRunId: 'workflow-run-1',
        inherit_host_mounts: false,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'subagent_concurrency_limit_reached',
        message: 'Maximum concurrent subagents (3) reached for this workflow.',
        retryable: true,
        recommended_action: 'wait_for_subagents',
        active_subagent_ids: ['active-1', 'active-2', 'active-3'],
      }),
    });
  });

  it('includes only non-terminal active IDs in active_subagent_ids when terminal executions are present', async () => {
    const context = buildSpawnContext();
    const executions = [
      {
        id: 'terminal-1',
        status: 'Completed',
        assigned_files: [],
        parent_container_id: 'parent-container-1',
        depth: 1,
        created_at: new Date(),
      } as SubagentExecutionView,
      {
        id: 'terminal-2',
        status: 'Failed',
        assigned_files: [],
        parent_container_id: 'parent-container-1',
        depth: 1,
        created_at: new Date(),
      } as SubagentExecutionView,
      {
        id: 'running-1',
        status: 'Running',
        assigned_files: [],
        parent_container_id: 'parent-container-1',
        depth: 1,
        created_at: new Date(),
      } as SubagentExecutionView,
      {
        id: 'running-2',
        status: 'Running',
        assigned_files: [],
        parent_container_id: 'parent-container-1',
        depth: 1,
        created_at: new Date(),
      } as SubagentExecutionView,
      {
        id: 'running-3',
        status: 'Running',
        assigned_files: [],
        parent_container_id: 'parent-container-1',
        depth: 1,
        created_at: new Date(),
      } as SubagentExecutionView,
    ];
    vi.mocked(
      context.subagentReadModel.findByParentContainerId,
    ).mockResolvedValue(executions);

    await expect(
      spawnSubagentAsyncOperation(context, 'parent-container-1', {
        agent_profile: 'general',
        task_prompt: 'Test task',
        tools: [],
        tier: 'heavy',
        workflowRunId: 'workflow-run-1',
        inherit_host_mounts: false,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'subagent_concurrency_limit_reached',
        message: 'Maximum concurrent subagents (3) reached for this workflow.',
        retryable: true,
        recommended_action: 'wait_for_subagents',
        active_subagent_ids: ['running-1', 'running-2', 'running-3'],
      }),
    });
  });

  it('generates the shared execution id and links it to its chat session at created-time', async () => {
    const context = buildSpawnContext();

    const executionId = await spawnSubagentAsyncOperation(
      context,
      'parent-container-1',
      {
        agent_profile: 'general',
        task_prompt: 'Inspect the project',
        tools: [],
        tier: 'heavy',
        workflowRunId: 'workflow-run-1',
        inherit_host_mounts: false,
      },
    );

    expect(executionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(context.executionEvents.created).toHaveBeenCalledWith(
      executionId,
      expect.objectContaining({
        kind: 'subagent',
        workflow_run_id: 'workflow-run-1',
        chat_session_id: 'subagent-chat-session-1',
      }),
    );
  });

  it('writes the subagent_details satellite keyed by the generated id with lineage/delegation/assigned fields', async () => {
    const context = buildSpawnContext();

    const executionId = await spawnSubagentAsyncOperation(
      context,
      'parent-container-1',
      {
        agent_profile: 'general',
        task_prompt: 'Inspect the project',
        tools: [],
        tier: 'heavy',
        workflowRunId: 'workflow-run-1',
        inherit_host_mounts: false,
        assigned_files: ['src/a.ts', 'src/b.ts'],
        delegation_contract_id: 'contract-1',
        lineage_trace_id: 'trace-1',
        lineage_parent_trace_id: 'parent-trace-1',
      },
    );

    expect(context.subagentDetailsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        execution_id: executionId,
        parent_container_id: 'parent-container-1',
        depth: 1,
        assigned_files: ['src/a.ts', 'src/b.ts'],
        delegation_contract_id: 'contract-1',
        lineage_trace_id: 'trace-1',
        lineage_parent_trace_id: 'parent-trace-1',
      }),
    );
  });

  it('marks the execution failed instead of provisioning an empty workspace when scope base path cannot resolve', async () => {
    const context = buildSpawnContext();
    vi.mocked(
      context.gitWorktreeService.resolveProjectBasePath,
    ).mockRejectedValue(new Error('project base path missing'));

    const executionId = await spawnSubagentAsyncOperation(
      context,
      'parent-container-1',
      {
        agent_profile: 'general',
        task_prompt: 'Inspect the project',
        tools: [],
        tier: 'heavy',
        workflowRunId: 'workflow-run-1',
        inherit_host_mounts: false,
      },
    );

    expect(executionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    await vi.waitFor(() => {
      expect(
        context.containerOrchestrator.provisionContainer,
      ).not.toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(context.executionEvents.failed).toHaveBeenCalledWith(
        executionId,
        expect.objectContaining({
          failure_reason: 'provision_failed',
          error_message: expect.stringContaining(
            "Unable to resolve workspace mount path for workflow scope 'project-scope-1'",
          ),
        }),
      );
    });
  });

  it('returns the execution id before container provisioning completes', async () => {
    const context = buildSpawnContext();
    let resolveProvisioning: (value: string) => void = () => {};
    const provisioningPromise = new Promise<string>((resolve) => {
      resolveProvisioning = resolve;
    });
    vi.mocked(context.containerOrchestrator.provisionContainer).mockReturnValue(
      provisioningPromise,
    );

    const operationPromise = spawnSubagentAsyncOperation(
      context,
      'parent-container-1',
      {
        agent_profile: 'general',
        task_prompt: 'Inspect the project',
        tools: [],
        tier: 'heavy',
        workflowRunId: 'workflow-run-1',
        inherit_host_mounts: false,
      },
    );

    const executionId = await Promise.race([
      operationPromise,
      new Promise<string>((_, reject) =>
        setTimeout(() => {
          reject(new Error('spawn operation blocked on provisioning'));
        }, 100),
      ),
    ]);

    expect(executionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    resolveProvisioning('child-container-1');
    await provisioningPromise;
  });

  it('rejects a spawn when a non-terminal subagent already exists for the same parent + role', async () => {
    const context = buildSpawnContext();
    vi.mocked(
      context.subagentReadModel.findByParentContainerId,
    ).mockResolvedValue([
      {
        id: 's1',
        status: 'Running',
        role: 'implement',
        parent_container_id: 'parent-container-1',
        depth: 1,
        created_at: new Date(),
      } as never,
    ]);

    await expect(
      spawnSubagentAsyncOperation(context, 'parent-container-1', {
        agent_profile: 'general',
        task_prompt: 'Test task',
        tools: [],
        tier: 'heavy',
        workflowRunId: 'workflow-run-1',
        inherit_host_mounts: false,
        role: 'implement',
      }),
    ).rejects.toMatchObject({
      response: { code: 'duplicate_subagent_for_step' },
    });
  });

  it('forwards resumeSessionTreeId to scheduleSubagentExecutionKickoff', async () => {
    const context = buildSpawnContext();

    await spawnSubagentAsyncOperation(context, 'parent-container-1', {
      agent_profile: 'general',
      task_prompt: 'Test task',
      tools: [],
      tier: 'heavy',
      workflowRunId: 'workflow-run-1',
      inherit_host_mounts: false,
      resumeSessionTreeId: 'tree-1',
    });

    await vi.waitFor(() => {
      expect(scheduleSubagentExecutionKickoff).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ resumeSessionTreeId: 'tree-1' }),
      );
    });
  });

  // FU-5 GATE: proves the spawning step's YAML id (`parent_step_id`) reaches
  // the skill mount — i.e. a step-scoped `workflow_skill_bindings` row is
  // included in the subagent's mounted skill set, not just workflow-level
  // bindings (the "known residual gap" flagged in the Task 4/5 reports).
  it('mounts a step-scoped skill binding when parent_step_id is supplied', async () => {
    const context = buildSpawnContext();
    vi.mocked(context.runRepo.findById).mockResolvedValue({
      id: 'workflow-run-1',
      workflow_id: 'implement_workflow',
      state_variables: {
        trigger: {
          scopeId: 'project-scope-1',
          repositoryUrl: 'https://github.com/org/repo',
        },
      },
    } as never);
    vi.mocked(context.workflowRepo.findById).mockResolvedValue({
      name: 'implement-workflow',
    } as never);
    vi.mocked(context.workflowSkillBindings.listForWorkflow).mockResolvedValue([
      {
        id: 'step-binding',
        workflow_name: 'implement-workflow',
        step_id: 'implement',
        skill_name: 'step-bound',
        provenance: null,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      },
    ] as never);
    vi.mocked(context.skillCatalog.listSkills).mockReturnValue([
      {
        id: 'step-bound',
        name: 'step-bound',
        description: 'Step-bound skill',
        skillMarkdown: '# step-bound',
        compatibility: null,
        category: null,
        tags: [],
        metadata: null,
        scope: null,
        isActive: true,
        version: 1,
        source: 'admin',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        rootPath: '/skills/step-bound',
      } as never,
    ]);

    await spawnSubagentAsyncOperation(context, 'parent-container-1', {
      agent_profile: 'general',
      task_prompt: 'Inspect the project',
      tools: [],
      tier: 'heavy',
      workflowRunId: 'workflow-run-1',
      inherit_host_mounts: false,
      parent_step_id: 'implement',
    });

    await vi.waitFor(() => {
      expect(context.skillMounting.prepareSkillMount).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ name: 'step-bound' }),
        ]),
      );
    });
  });

  it('does not mount a step-scoped skill binding when parent_step_id is absent', async () => {
    const context = buildSpawnContext();
    vi.mocked(context.runRepo.findById).mockResolvedValue({
      id: 'workflow-run-1',
      workflow_id: 'implement_workflow',
      state_variables: {
        trigger: {
          scopeId: 'project-scope-1',
          repositoryUrl: 'https://github.com/org/repo',
        },
      },
    } as never);
    vi.mocked(context.workflowRepo.findById).mockResolvedValue({
      name: 'implement-workflow',
    } as never);
    vi.mocked(context.workflowSkillBindings.listForWorkflow).mockResolvedValue([
      {
        id: 'step-binding',
        workflow_name: 'implement-workflow',
        step_id: 'implement',
        skill_name: 'step-bound',
        provenance: null,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      },
    ] as never);
    vi.mocked(context.skillCatalog.listSkills).mockReturnValue([
      {
        id: 'step-bound',
        name: 'step-bound',
        description: 'Step-bound skill',
        skillMarkdown: '# step-bound',
        compatibility: null,
        category: null,
        tags: [],
        metadata: null,
        scope: null,
        isActive: true,
        version: 1,
        source: 'admin',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        rootPath: '/skills/step-bound',
      } as never,
    ]);

    await spawnSubagentAsyncOperation(context, 'parent-container-1', {
      agent_profile: 'general',
      task_prompt: 'Inspect the project',
      tools: [],
      tier: 'heavy',
      workflowRunId: 'workflow-run-1',
      inherit_host_mounts: false,
    });

    await vi.waitFor(() => {
      expect(context.skillMounting.prepareSkillMount).toHaveBeenCalled();
    });
    expect(context.skillMounting.prepareSkillMount).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.arrayContaining([
        expect.objectContaining({ name: 'step-bound' }),
      ]),
    );
  });
});
