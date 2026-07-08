import type { Logger } from '@nestjs/common';
import { ChatSessionStatus } from '@nexus/core';
import { describe, expect, it, vi } from 'vitest';
import type { SubagentExecutionView } from './subagent-execution-view.types';
import type { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import type { ExecutionEventPublisher } from '../../execution-lifecycle/execution-event.publisher';
import type { SubagentExecutionReadModel } from './subagent-execution-read-model';
import type { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import type { SkillMountingService } from '../../tool-runtime/skill-mounting.service';
import type { MeshDelegationService } from './mesh-delegation.service';
import type { SubagentParentResumeService } from './subagent-parent-resume.service';
import {
  checkSubagentStatusOperation,
  handleSubagentCompletionOperation,
} from './subagent-orchestrator.runtime.operations';
import { buildSubagentSkillMountKey } from './subagent-orchestrator.skills.helpers';

function buildExecution(
  overrides: Partial<SubagentExecutionView> = {},
): SubagentExecutionView {
  return {
    id: 'subagent-exec-1',
    parent_container_id: 'parent-container-1',
    child_container_id: 'child-container-1',
    delegation_contract_id: undefined,
    lineage_trace_id: undefined,
    lineage_parent_trace_id: undefined,
    parent_session_tree_id: undefined,
    depth: 1,
    status: 'Running',
    result: undefined,
    assigned_files: undefined,
    created_at: new Date('2026-04-30T00:00:00.000Z'),
    completed_at: undefined,
    ...overrides,
  };
}

function buildSubagentDetailsRepoMock(): SubagentDetailsRepository {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
  } as unknown as SubagentDetailsRepository;
}

function buildExecutionEventsMock(): ExecutionEventPublisher {
  return {
    completed: vi.fn().mockResolvedValue(undefined),
    failed: vi.fn().mockResolvedValue(undefined),
    cancelled: vi.fn().mockResolvedValue(undefined),
  } as unknown as ExecutionEventPublisher;
}

function buildReadModelMock(
  execution: SubagentExecutionView,
): SubagentExecutionReadModel {
  return {
    findById: vi.fn().mockResolvedValue(execution),
  } as unknown as SubagentExecutionReadModel;
}

function buildSessionHydrationMock() {
  return {
    saveSessionForChat: vi.fn().mockResolvedValue('tree-chat'),
    saveSessionForWorkflowChat: vi.fn().mockResolvedValue('tree-workflow-chat'),
  };
}

describe('handleSubagentCompletionOperation', () => {
  it('stores the terminal agent_end payload, emits workflow-scoped completion, and cleans up runtime resources', async () => {
    const terminalPayload = {
      output: { response: 'final answer', stopReason: 'stop' },
    };
    const execution = buildExecution();
    const executionEvents = buildExecutionEventsMock();
    const emitSubagentLifecycleEvent = vi.fn().mockResolvedValue(undefined);
    const killContainer = vi.fn().mockResolvedValue(undefined);
    const removeContainer = vi.fn().mockResolvedValue(undefined);
    const cleanupSkillMount = vi.fn();
    const clearRunnerConfig = vi.fn().mockResolvedValue(undefined);
    const sessionHydration = buildSessionHydrationMock();
    const detailsRepo = buildSubagentDetailsRepoMock();

    await handleSubagentCompletionOperation({
      logger: {
        log: vi.fn(),
        error: vi.fn(),
      },
      executionId: execution.id,
      workflowRunId: 'workflow-run-1',
      result: terminalPayload,
      jwtSecret: 'test-secret',
      executionEvents,
      subagentReadModel: buildReadModelMock(execution),
      subagentDetailsRepo: detailsRepo,
      containerOrchestrator: {
        killContainer,
        removeContainer,
      } as unknown as ContainerOrchestratorService,
      skillMounting: {
        cleanupSkillMount,
      } as unknown as SkillMountingService,
      sessionHydration,
      parentResumeService: {
        resumeParentAfterSubagent: vi.fn().mockResolvedValue(undefined),
      } as unknown as SubagentParentResumeService,
      meshDelegation: {
        handleSubagentCompletion: vi.fn().mockResolvedValue(null),
        dispatchQueuedDelegations: vi.fn().mockResolvedValue(undefined),
      } as unknown as MeshDelegationService,
      emitSubagentLifecycleEvent,
      spawnSubagentFromDelegation: vi.fn().mockResolvedValue('queued-exec-1'),
      clearRunnerConfig,
    });
    expect(executionEvents.completed).toHaveBeenCalledWith(execution.id);
    expect(detailsRepo.upsert).toHaveBeenCalledWith({
      execution_id: execution.id,
      result: terminalPayload,
      is_active: false,
    });
    expect(emitSubagentLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'completion.succeeded',
        outcome: 'success',
        workflowRunId: 'workflow-run-1',
        parentContainerId: execution.parent_container_id,
        subagentExecutionId: execution.id,
      }),
    );
    expect(killContainer).toHaveBeenCalledWith(execution.child_container_id);
    expect(removeContainer).toHaveBeenCalledWith(execution.child_container_id);
    expect(cleanupSkillMount).toHaveBeenCalledWith(
      buildSubagentSkillMountKey(execution.id),
    );
    expect(clearRunnerConfig).toHaveBeenCalledWith(
      'workflow-run-1',
      execution.id,
    );
    expect(sessionHydration.saveSessionForWorkflowChat).not.toHaveBeenCalled();
    expect(sessionHydration.saveSessionForChat).not.toHaveBeenCalled();
  });

  it('persists workflow+chat linked session tree for subagent chats when workflowRunId is present', async () => {
    const terminalPayload = {
      output: { response: 'final answer', stopReason: 'stop' },
    };
    const execution = buildExecution({
      subagent_chat_session_id: 'chat-session-1',
    });
    const sessionHydration = buildSessionHydrationMock();
    const killContainer = vi.fn().mockResolvedValue(undefined);
    const removeContainer = vi.fn().mockResolvedValue(undefined);

    await handleSubagentCompletionOperation({
      logger: {
        log: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      },
      executionId: execution.id,
      workflowRunId: 'workflow-run-1',
      result: terminalPayload,
      jwtSecret: 'test-secret',
      executionEvents: buildExecutionEventsMock(),
      subagentReadModel: buildReadModelMock(execution),
      containerOrchestrator: {
        killContainer,
        removeContainer,
      } as unknown as ContainerOrchestratorService,
      skillMounting: {
        cleanupSkillMount: vi.fn(),
      } as unknown as SkillMountingService,
      sessionHydration,
      parentResumeService: {
        resumeParentAfterSubagent: vi.fn().mockResolvedValue(undefined),
      } as unknown as SubagentParentResumeService,
      meshDelegation: {
        handleSubagentCompletion: vi.fn().mockResolvedValue(null),
        dispatchQueuedDelegations: vi.fn().mockResolvedValue(undefined),
      } as unknown as MeshDelegationService,
      emitSubagentLifecycleEvent: vi.fn().mockResolvedValue(undefined),
      spawnSubagentFromDelegation: vi.fn().mockResolvedValue('queued-exec-1'),
      clearRunnerConfig: vi.fn().mockResolvedValue(undefined),
    });

    expect(sessionHydration.saveSessionForWorkflowChat).toHaveBeenCalledWith(
      execution.child_container_id,
      'workflow-run-1',
      'chat-session-1',
    );
    expect(
      sessionHydration.saveSessionForWorkflowChat.mock.invocationCallOrder[0],
    ).toBeLessThan(killContainer.mock.invocationCallOrder[0]);
    expect(
      sessionHydration.saveSessionForWorkflowChat.mock.invocationCallOrder[0],
    ).toBeLessThan(removeContainer.mock.invocationCallOrder[0]);
    expect(sessionHydration.saveSessionForChat).not.toHaveBeenCalled();
  });

  it('marks linked subagent chat sessions completed when execution completes', async () => {
    const terminalPayload = {
      output: { response: 'final answer', stopReason: 'stop' },
    };
    const execution = buildExecution({
      subagent_chat_session_id: 'chat-session-1',
    });
    const chatSessionUpdate = vi.fn().mockResolvedValue(undefined);

    await handleSubagentCompletionOperation({
      logger: {
        log: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      },
      executionId: execution.id,
      workflowRunId: 'workflow-run-1',
      result: terminalPayload,
      jwtSecret: 'test-secret',
      executionEvents: buildExecutionEventsMock(),
      subagentReadModel: buildReadModelMock(execution),
      subagentDetailsRepo: buildSubagentDetailsRepoMock(),
      chatSessionRepo: {
        update: chatSessionUpdate,
      },
      containerOrchestrator: {
        killContainer: vi.fn().mockResolvedValue(undefined),
        removeContainer: vi.fn().mockResolvedValue(undefined),
      } as unknown as ContainerOrchestratorService,
      skillMounting: {
        cleanupSkillMount: vi.fn(),
      } as unknown as SkillMountingService,
      sessionHydration: buildSessionHydrationMock(),
      parentResumeService: {
        resumeParentAfterSubagent: vi.fn().mockResolvedValue(undefined),
      } as unknown as SubagentParentResumeService,
      meshDelegation: {
        handleSubagentCompletion: vi.fn().mockResolvedValue(null),
        dispatchQueuedDelegations: vi.fn().mockResolvedValue(undefined),
      } as unknown as MeshDelegationService,
      emitSubagentLifecycleEvent: vi.fn().mockResolvedValue(undefined),
      spawnSubagentFromDelegation: vi.fn().mockResolvedValue('queued-exec-1'),
      clearRunnerConfig: vi.fn().mockResolvedValue(undefined),
    });

    expect(chatSessionUpdate).toHaveBeenCalledWith(
      'chat-session-1',
      expect.objectContaining({
        status: ChatSessionStatus.COMPLETED,
        execution_state: 'completed',
        error_message: null,
        failure_info: null,
        retry_metadata: null,
        completed_at: expect.any(Date),
      }),
    );
  });

  it('records a failure (not a completion) when the terminal agent_end reports ok:false', async () => {
    const terminatedPayload = {
      type: 'agent_end',
      output: {
        ok: false,
        response: 'Let me write out the comprehensive findings JSON now.',
        stopReason: 'error',
        errorMessage: 'terminated',
      },
    };
    const execution = buildExecution();
    const executionEvents = buildExecutionEventsMock();
    const emitSubagentLifecycleEvent = vi.fn().mockResolvedValue(undefined);
    const killContainer = vi.fn().mockResolvedValue(undefined);
    const removeContainer = vi.fn().mockResolvedValue(undefined);

    await handleSubagentCompletionOperation({
      logger: { log: vi.fn(), error: vi.fn() },
      executionId: execution.id,
      workflowRunId: 'workflow-run-1',
      result: terminatedPayload,
      jwtSecret: 'test-secret',
      executionEvents,
      subagentReadModel: buildReadModelMock(execution),
      subagentDetailsRepo: buildSubagentDetailsRepoMock(),
      containerOrchestrator: {
        killContainer,
        removeContainer,
      } as unknown as ContainerOrchestratorService,
      skillMounting: {
        cleanupSkillMount: vi.fn(),
      } as unknown as SkillMountingService,
      sessionHydration: buildSessionHydrationMock(),
      parentResumeService: {
        resumeParentAfterSubagent: vi.fn().mockResolvedValue(undefined),
      } as unknown as SubagentParentResumeService,
      meshDelegation: {
        handleSubagentCompletion: vi.fn().mockResolvedValue(null),
        dispatchQueuedDelegations: vi.fn().mockResolvedValue(undefined),
      } as unknown as MeshDelegationService,
      emitSubagentLifecycleEvent,
      spawnSubagentFromDelegation: vi.fn().mockResolvedValue('queued-exec-1'),
      clearRunnerConfig: vi.fn().mockResolvedValue(undefined),
    });

    expect(executionEvents.failed).toHaveBeenCalledWith(execution.id, {
      failure_reason: 'agent_error',
      error_message: 'terminated',
    });
    expect(executionEvents.completed).not.toHaveBeenCalled();
    expect(emitSubagentLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'completion.failed',
        outcome: 'failure',
        subagentExecutionId: execution.id,
      }),
    );
    expect(emitSubagentLifecycleEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'completion.succeeded' }),
    );
    // Cleanup must still happen so the container/runtime resources are released.
    expect(killContainer).toHaveBeenCalledWith(execution.child_container_id);
    expect(removeContainer).toHaveBeenCalledWith(execution.child_container_id);
  });

  it('marks the linked chat session failed with the agent error message when the agent_end reports an error', async () => {
    const terminatedPayload = {
      type: 'agent_end',
      output: {
        ok: false,
        response: 'partial work',
        stopReason: 'error',
        errorMessage: 'terminated',
      },
    };
    const execution = buildExecution({
      subagent_chat_session_id: 'chat-session-1',
    });
    const chatSessionUpdate = vi.fn().mockResolvedValue(undefined);

    await handleSubagentCompletionOperation({
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
      executionId: execution.id,
      workflowRunId: 'workflow-run-1',
      result: terminatedPayload,
      jwtSecret: 'test-secret',
      executionEvents: buildExecutionEventsMock(),
      subagentReadModel: buildReadModelMock(execution),
      subagentDetailsRepo: buildSubagentDetailsRepoMock(),
      chatSessionRepo: { update: chatSessionUpdate },
      containerOrchestrator: {
        killContainer: vi.fn().mockResolvedValue(undefined),
        removeContainer: vi.fn().mockResolvedValue(undefined),
      } as unknown as ContainerOrchestratorService,
      skillMounting: {
        cleanupSkillMount: vi.fn(),
      } as unknown as SkillMountingService,
      sessionHydration: buildSessionHydrationMock(),
      parentResumeService: {
        resumeParentAfterSubagent: vi.fn().mockResolvedValue(undefined),
      } as unknown as SubagentParentResumeService,
      meshDelegation: {
        handleSubagentCompletion: vi.fn().mockResolvedValue(null),
        dispatchQueuedDelegations: vi.fn().mockResolvedValue(undefined),
      } as unknown as MeshDelegationService,
      emitSubagentLifecycleEvent: vi.fn().mockResolvedValue(undefined),
      spawnSubagentFromDelegation: vi.fn().mockResolvedValue('queued-exec-1'),
      clearRunnerConfig: vi.fn().mockResolvedValue(undefined),
    });

    expect(chatSessionUpdate).toHaveBeenCalledWith(
      'chat-session-1',
      expect.objectContaining({
        status: ChatSessionStatus.FAILED,
        execution_state: 'failed',
        error_message: 'terminated',
        completed_at: expect.any(Date),
      }),
    );
  });

  it('completes safely without workflowRunId and does not clear runner config', async () => {
    const terminalPayload = {
      output: { response: 'final answer', stopReason: 'stop' },
    };
    const execution = buildExecution();
    const executionEvents = buildExecutionEventsMock();
    const emitSubagentLifecycleEvent = vi.fn().mockResolvedValue(undefined);
    const clearRunnerConfig = vi.fn().mockResolvedValue(undefined);
    const sessionHydration = buildSessionHydrationMock();

    await handleSubagentCompletionOperation({
      logger: {
        log: vi.fn(),
        error: vi.fn(),
      },
      executionId: execution.id,
      result: terminalPayload,
      jwtSecret: 'test-secret',
      executionEvents,
      subagentReadModel: buildReadModelMock(execution),
      subagentDetailsRepo: buildSubagentDetailsRepoMock(),
      containerOrchestrator: {
        killContainer: vi.fn().mockResolvedValue(undefined),
        removeContainer: vi.fn().mockResolvedValue(undefined),
      } as unknown as ContainerOrchestratorService,
      skillMounting: {
        cleanupSkillMount: vi.fn(),
      } as unknown as SkillMountingService,
      sessionHydration,
      parentResumeService: {
        resumeParentAfterSubagent: vi.fn().mockResolvedValue(undefined),
      } as unknown as SubagentParentResumeService,
      meshDelegation: {
        handleSubagentCompletion: vi.fn().mockResolvedValue(null),
        dispatchQueuedDelegations: vi.fn().mockResolvedValue(undefined),
      } as unknown as MeshDelegationService,
      emitSubagentLifecycleEvent,
      spawnSubagentFromDelegation: vi.fn().mockResolvedValue('queued-exec-1'),
      clearRunnerConfig,
    });

    expect(executionEvents.completed).toHaveBeenCalledWith(execution.id);
    expect(emitSubagentLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'completion.succeeded',
        outcome: 'success',
        parentContainerId: execution.parent_container_id,
        subagentExecutionId: execution.id,
      }),
    );
    expect(clearRunnerConfig).not.toHaveBeenCalled();
    expect(sessionHydration.saveSessionForWorkflowChat).not.toHaveBeenCalled();
    expect(sessionHydration.saveSessionForChat).not.toHaveBeenCalled();
  });

  it('falls back to chat-only persistence when workflowRunId is missing', async () => {
    const terminalPayload = {
      output: { response: 'final answer', stopReason: 'stop' },
    };
    const execution = buildExecution({
      subagent_chat_session_id: 'chat-session-2',
    });
    const sessionHydration = buildSessionHydrationMock();

    await handleSubagentCompletionOperation({
      logger: {
        log: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      },
      executionId: execution.id,
      result: terminalPayload,
      jwtSecret: 'test-secret',
      executionEvents: buildExecutionEventsMock(),
      subagentReadModel: buildReadModelMock(execution),
      subagentDetailsRepo: buildSubagentDetailsRepoMock(),
      containerOrchestrator: {
        killContainer: vi.fn().mockResolvedValue(undefined),
        removeContainer: vi.fn().mockResolvedValue(undefined),
      } as unknown as ContainerOrchestratorService,
      skillMounting: {
        cleanupSkillMount: vi.fn(),
      } as unknown as SkillMountingService,
      sessionHydration,
      parentResumeService: {
        resumeParentAfterSubagent: vi.fn().mockResolvedValue(undefined),
      } as unknown as SubagentParentResumeService,
      meshDelegation: {
        handleSubagentCompletion: vi.fn().mockResolvedValue(null),
        dispatchQueuedDelegations: vi.fn().mockResolvedValue(undefined),
      } as unknown as MeshDelegationService,
      emitSubagentLifecycleEvent: vi.fn().mockResolvedValue(undefined),
      spawnSubagentFromDelegation: vi.fn().mockResolvedValue('queued-exec-1'),
      clearRunnerConfig: vi.fn().mockResolvedValue(undefined),
    });

    expect(sessionHydration.saveSessionForChat).toHaveBeenCalledWith(
      execution.child_container_id,
      'chat-session-2',
    );
    expect(sessionHydration.saveSessionForWorkflowChat).not.toHaveBeenCalled();
  });
});

describe('checkSubagentStatusOperation', () => {
  it('returns a sanitized result for the requested subagent execution', async () => {
    const execution = buildExecution({
      status: 'Completed',
      result: {
        response: '<think>hidden chain of thought</think>Visible response',
        metadata: { tokenCount: 12 },
      },
      completed_at: new Date('2026-04-30T00:01:00.000Z'),
    });

    const result = await checkSubagentStatusOperation({
      parentContainerId: execution.parent_container_id,
      executionId: ` ${execution.id} `,
      subagentReadModel: {
        findById: vi.fn().mockResolvedValue(execution),
      } as unknown as SubagentExecutionReadModel,
      emitSubagentLifecycleEvent: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.result).toEqual({
      response: 'Visible response',
      metadata: { tokenCount: 12 },
    });
  });

  it('returns sanitized latest turn progress for a running subagent', async () => {
    const execution = buildExecution({ status: 'Running' });
    const latestTurnAt = new Date('2026-04-30T00:02:00.000Z');

    const result = await (
      checkSubagentStatusOperation as unknown as (params: {
        parentContainerId: string;
        executionId: string;
        workflowRunId: string;
        subagentReadModel: SubagentExecutionReadModel;
        emitSubagentLifecycleEvent: (params: never) => Promise<void>;
        findLatestTurnForStep: (params: {
          workflowRunId: string;
          stepId: string;
        }) => Promise<unknown>;
      }) => Promise<Record<string, unknown>>
    )({
      parentContainerId: execution.parent_container_id,
      executionId: execution.id,
      workflowRunId: 'workflow-run-1',
      subagentReadModel: {
        findById: vi.fn().mockResolvedValue(execution),
      } as unknown as SubagentExecutionReadModel,
      emitSubagentLifecycleEvent: vi.fn().mockResolvedValue(undefined),
      findLatestTurnForStep: vi.fn().mockResolvedValue({
        occurred_at: latestTurnAt,
        payload: {
          output: {
            response: '<think>private</think>visible progress',
            stopReason: 'toolUse',
          },
        },
      }),
    });

    expect(result.latest_response).toBe('visible progress');
    expect(result.latest_stop_reason).toBe('toolUse');
    expect(result.latest_turn_at).toBe(latestTurnAt);
  });

  it('omits latest response when the latest turn only contains thinking', async () => {
    const execution = buildExecution({ status: 'Running' });

    const result = await (
      checkSubagentStatusOperation as unknown as (params: {
        parentContainerId: string;
        executionId: string;
        workflowRunId: string;
        subagentReadModel: SubagentExecutionReadModel;
        emitSubagentLifecycleEvent: (params: never) => Promise<void>;
        findLatestTurnForStep: (params: {
          workflowRunId: string;
          stepId: string;
        }) => Promise<unknown>;
      }) => Promise<Record<string, unknown>>
    )({
      parentContainerId: execution.parent_container_id,
      executionId: execution.id,
      workflowRunId: 'workflow-run-1',
      subagentReadModel: {
        findById: vi.fn().mockResolvedValue(execution),
      } as unknown as SubagentExecutionReadModel,
      emitSubagentLifecycleEvent: vi.fn().mockResolvedValue(undefined),
      findLatestTurnForStep: vi.fn().mockResolvedValue({
        occurred_at: new Date('2026-04-30T00:02:00.000Z'),
        payload: {
          output: {
            response: '<think>private only</think>',
            stopReason: 'toolUse',
          },
        },
      }),
    });

    expect(result).not.toHaveProperty('latest_response');
    expect(result.latest_stop_reason).toBe('toolUse');
  });

  it('prefers sanitized terminal output response for a completed subagent', async () => {
    const execution = buildExecution({
      status: 'Completed',
      result: {
        output: {
          response: '<think>terminal thoughts</think>final response',
          stopReason: 'stop',
        },
      },
      completed_at: new Date('2026-04-30T00:03:00.000Z'),
    });
    const latestTurnAt = new Date('2026-04-30T00:02:00.000Z');

    const result = await (
      checkSubagentStatusOperation as unknown as (params: {
        parentContainerId: string;
        executionId: string;
        workflowRunId: string;
        subagentReadModel: SubagentExecutionReadModel;
        emitSubagentLifecycleEvent: (params: never) => Promise<void>;
        findLatestTurnForStep: (params: {
          workflowRunId: string;
          stepId: string;
        }) => Promise<unknown>;
      }) => Promise<Record<string, unknown>>
    )({
      parentContainerId: execution.parent_container_id,
      executionId: execution.id,
      workflowRunId: 'workflow-run-1',
      subagentReadModel: {
        findById: vi.fn().mockResolvedValue(execution),
      } as unknown as SubagentExecutionReadModel,
      emitSubagentLifecycleEvent: vi.fn().mockResolvedValue(undefined),
      findLatestTurnForStep: vi.fn().mockResolvedValue({
        occurred_at: latestTurnAt,
        payload: {
          output: {
            response: 'older progress',
            stopReason: 'toolUse',
          },
        },
      }),
    });

    expect(result.latest_response).toBe('final response');
    expect(result.latest_stop_reason).toBe('stop');
    expect(result.latest_turn_at).toEqual(execution.completed_at);
  });
});
