import { describe, expect, it, vi } from 'vitest';
import { ChatSessionStatus } from '@nexus/core';
import type { SubagentSpawnOperationsContext } from './subagent-orchestrator.operations.types';
import { kickoffSubagentExecution } from './subagent-orchestrator.kickoff-execution.operations';

function buildKickoffContext(): SubagentSpawnOperationsContext {
  return {
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    } as never,
    jwtSecret: 'test-secret',
    subagentRepo: {
      findById: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
      findByParentContainerId: vi.fn(),
      findByChildContainerId: vi.fn(),
      create: vi.fn(),
    } as never,
    chatSessionRepo: {
      update: vi.fn().mockResolvedValue({ id: 'subagent-chat-session-1' }),
      findByContainerId: vi.fn(),
      create: vi.fn(),
    } as never,
    containerOrchestrator: {
      provisionContainer: vi.fn(),
      getContainerHostMountBindings: vi.fn(),
      killContainer: vi.fn().mockResolvedValue(undefined),
      removeContainer: vi.fn().mockResolvedValue(undefined),
      fetchContainerLogSnapshot: vi.fn().mockResolvedValue('container logs'),
    } as never,
    runRepo: {
      findById: vi.fn(),
    } as never,
    aiConfig: {
      resolveStepSettings: vi.fn(),
      resolveRunnerProviderConfig: vi.fn(),
      listSkillCategories: vi.fn(),
    } as never,
    stageSkillPolicy: {
      resolveAssignedSkills: vi.fn(),
    } as never,
    workflowRepo: {
      findById: vi.fn(),
    },
    workflowSkillBindings: {
      listForWorkflow: vi.fn(),
    },
    skillCatalog: {
      listSkills: vi.fn(),
    },
    runnerConfigStore: {
      store: vi.fn(),
      get: vi.fn().mockResolvedValue({
        harnessId: 'nexus-light',
        model: {
          provider: 'test-provider',
          model: 'test-model',
          auth: { type: 'api_key', apiKey: 'test-api-key' } as const,
          baseUrl: 'https://provider.example.test',
          providerConfig: {},
          temperature: 0.7,
          thinkingLevel: 'low',
        },
        prompt: {
          systemPrompt: 'system prompt',
          initialPrompt: 'initial prompt',
        },
      }),
    } as never,
    containerHttpClient: {
      buildBaseUrl: vi.fn().mockReturnValue('http://127.0.0.1:8080'),
      waitForHealth: vi.fn().mockResolvedValue(undefined),
      executeAgent: vi.fn().mockResolvedValue({ ok: true }),
    } as never,
    systemSettings: {
      get: vi.fn(),
    } as never,
    skillMounting: {
      prepareSkillMount: vi.fn(),
      cleanupSkillMount: vi.fn(),
    } as never,
    toolMounting: {
      writeSdkToolAllowlist: vi.fn(),
      writeNexusActionAllowlist: vi.fn(),
    } as never,
    hostMountResolution: {
      resolveHostMountBindings: vi.fn(),
    } as never,
    agentProfileRepo: {
      findByName: vi.fn(),
      findAll: vi.fn(),
    } as never,
    gitWorktreeService: {
      resolveProjectBasePath: vi.fn(),
    } as never,
    resolveContainerIpAddress: vi.fn().mockResolvedValue('127.0.0.1'),
    emitSubagentLifecycleEvent: vi.fn().mockResolvedValue(undefined),
    resolveErrorMessage: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
    runParentContainerExclusive: async <T>(
      _parentContainerId: string,
      task: () => Promise<T>,
    ): Promise<T> => task(),
    sessionHydration: {
      injectSessionIntoContainer: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('kickoffSubagentExecution', () => {
  it('transitions the chat session from STARTING to RUNNING after successful kickoff', async () => {
    const context = buildKickoffContext();

    await kickoffSubagentExecution(context, {
      executionId: 'subagent-execution-1',
      workflowRunId: 'workflow-run-1',
      parentContainerId: 'parent-container-1',
      childContainerId: 'child-container-1',
      skillMountKey: 'skill-mount-key-1',
      subagentChatSessionId: 'subagent-chat-session-1',
    });

    expect(context.chatSessionRepo.update).toHaveBeenCalledWith(
      'subagent-chat-session-1',
      {
        status: ChatSessionStatus.RUNNING,
        execution_state: 'running',
      },
    );
  });

  it('does not attempt to update a chat session when subagentChatSessionId is null', async () => {
    const context = buildKickoffContext();

    await kickoffSubagentExecution(context, {
      executionId: 'subagent-execution-1',
      workflowRunId: 'workflow-run-1',
      parentContainerId: 'parent-container-1',
      childContainerId: 'child-container-1',
      skillMountKey: 'skill-mount-key-1',
      subagentChatSessionId: null,
    });

    expect(context.chatSessionRepo.update).not.toHaveBeenCalled();
  });

  it('does not attempt to update a chat session when subagentChatSessionId is undefined', async () => {
    const context = buildKickoffContext();

    await kickoffSubagentExecution(context, {
      executionId: 'subagent-execution-1',
      workflowRunId: 'workflow-run-1',
      parentContainerId: 'parent-container-1',
      childContainerId: 'child-container-1',
      skillMountKey: 'skill-mount-key-1',
    });

    expect(context.chatSessionRepo.update).not.toHaveBeenCalled();
  });

  it('emits the execution failed lifecycle event with provision_failed when kickoff fails', async () => {
    const context = buildKickoffContext();
    const failed = vi.fn().mockResolvedValue(undefined);
    context.executionEvents = { failed } as never;
    context.subagentReadModel = {
      findById: vi.fn().mockResolvedValue({
        id: 'subagent-execution-1',
        status: 'Running',
      }),
    } as never;
    context.runnerConfigStore = {
      ...context.runnerConfigStore,
      get: context.runnerConfigStore.get,
      delete: vi.fn().mockResolvedValue(undefined),
    } as never;
    vi.mocked(context.containerHttpClient.executeAgent).mockResolvedValue({
      ok: false,
      error: 'agent kickoff exploded',
    });

    await kickoffSubagentExecution(context, {
      executionId: 'subagent-execution-1',
      workflowRunId: 'workflow-run-1',
      parentContainerId: 'parent-container-1',
      childContainerId: 'child-container-1',
      skillMountKey: 'skill-mount-key-1',
      subagentChatSessionId: 'subagent-chat-session-1',
    });

    expect(failed).toHaveBeenCalledWith(
      'subagent-execution-1',
      expect.objectContaining({
        failure_reason: 'provision_failed',
        error_message: 'agent kickoff exploded',
      }),
    );
  });

  it('injects resume session tree into container when resumeSessionTreeId is provided', async () => {
    const context = buildKickoffContext();
    const injectSessionIntoContainer = vi.fn().mockResolvedValue(undefined);
    context.sessionHydration = {
      injectSessionIntoContainer,
    };

    await kickoffSubagentExecution(context, {
      executionId: 'subagent-execution-1',
      workflowRunId: 'workflow-run-1',
      parentContainerId: 'parent-container-1',
      childContainerId: 'child-container-1',
      skillMountKey: 'skill-mount-key-1',
      resumeSessionTreeId: 'tree-id-1',
    });

    expect(injectSessionIntoContainer).toHaveBeenCalledWith(
      'child-container-1',
      'tree-id-1',
    );
    expect(injectSessionIntoContainer.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(context.containerHttpClient.executeAgent).mock
        .invocationCallOrder[0],
    );
    expect(context.containerHttpClient.executeAgent).toHaveBeenCalled();
  });

  it('does not inject session tree when resumeSessionTreeId is not provided', async () => {
    const context = buildKickoffContext();
    const injectSessionIntoContainer = vi.fn().mockResolvedValue(undefined);
    context.sessionHydration = {
      injectSessionIntoContainer,
    };

    await kickoffSubagentExecution(context, {
      executionId: 'subagent-execution-1',
      workflowRunId: 'workflow-run-1',
      parentContainerId: 'parent-container-1',
      childContainerId: 'child-container-1',
      skillMountKey: 'skill-mount-key-1',
    });

    expect(injectSessionIntoContainer).not.toHaveBeenCalled();
    expect(context.containerHttpClient.executeAgent).toHaveBeenCalled();
  });

  it('continues execution when session tree injection fails', async () => {
    const context = buildKickoffContext();
    const injectSessionIntoContainer = vi
      .fn()
      .mockRejectedValue(new Error('injection failed'));
    context.sessionHydration = {
      injectSessionIntoContainer,
    };
    const warnSpy = vi.mocked(context.logger.warn);

    await kickoffSubagentExecution(context, {
      executionId: 'subagent-execution-1',
      workflowRunId: 'workflow-run-1',
      parentContainerId: 'parent-container-1',
      childContainerId: 'child-container-1',
      skillMountKey: 'skill-mount-key-1',
      resumeSessionTreeId: 'tree-id-1',
    });

    expect(injectSessionIntoContainer).toHaveBeenCalledWith(
      'child-container-1',
      'tree-id-1',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to inject resume session tree'),
      expect.objectContaining({
        workflowRunId: 'workflow-run-1',
        executionId: 'subagent-execution-1',
        containerId: 'child-container-1',
        resumeSessionTreeId: 'tree-id-1',
      }),
    );
    expect(context.containerHttpClient.executeAgent).toHaveBeenCalled();
  });
});
