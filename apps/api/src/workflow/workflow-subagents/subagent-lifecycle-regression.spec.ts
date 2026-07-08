import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAgentEndGatewayCompat } from '../../telemetry/telemetry-gateway-runtime.helpers';
import { handleTurnEndGatewayCompat } from '../../telemetry/telemetry-gateway-runtime.helpers';
import { SubagentCoordinationService } from './subagent-coordination.service';
import type { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import type { SubagentExecutionReadModel } from './subagent-execution-read-model';
import type { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import type { RunnerConfigStoreService } from '../../redis/runner-config-store.service';
import type { SkillMountingService } from '../../tool-runtime/skill-mounting.service';
import type { ExecutionEventPublisher } from '../../execution-lifecycle/execution-event.publisher';
import type { EventLedgerRepository } from '../../runtime/database/repositories/event-ledger.repository';
import type { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import type { SubagentContainerLivenessProbe } from '../../execution-lifecycle/subagent-container-liveness.probe';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import type {
  ChatSessionDomainPort,
  IChatSessionRepositoryPort,
} from '../domain-ports';
import type { MeshDelegationService } from './mesh-delegation.service';
import type { SubagentLifecycleEventService } from './subagent-lifecycle-event.service';
import type { SubagentParentLockService } from './subagent-parent-lock.service';
import type { SubagentParentResumeService } from './subagent-parent-resume.service';
import type { SubagentProvisioningService } from './subagent-provisioning.service';
import type { SubagentExecution } from './subagent-orchestrator.types';
import type { AgentResponseStoreService } from '../../redis/agent-response-store.service';

type SubagentDetailsUpsertArgs = Parameters<
  SubagentDetailsRepository['upsert']
>[0];

describe('subagent multi-turn lifecycle', () => {
  const previousJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  afterEach(() => {
    if (previousJwtSecret === undefined) {
      Reflect.deleteProperty(process.env, 'JWT_SECRET');
      return;
    }

    process.env.JWT_SECRET = previousJwtSecret;
  });

  it('keeps execution running after tool-use turn_end and completes on agent_end', async () => {
    const execution: SubagentExecution = {
      id: 'subagent-exec-1',
      parent_container_id: 'parent-container-1',
      child_container_id: 'child-container-1',
      parent_session_tree_id: undefined,
      status: 'Running',
      result: undefined,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      completed_at: undefined,
      assigned_files: undefined,
      delegation_contract_id: undefined,
      lineage_trace_id: undefined,
      lineage_parent_trace_id: undefined,
      workflow_run_id: 'workflow-run-1',
    };

    const killContainer = vi.fn().mockResolvedValue(undefined);
    const removeContainer = vi.fn().mockResolvedValue(undefined);
    const cleanupSkillMount = vi.fn();
    const resumeParentAfterSubagent = vi.fn().mockResolvedValue(undefined);
    const handleSubagentCompletion = vi.fn().mockResolvedValue(null);
    const dispatchQueuedDelegations = vi.fn().mockResolvedValue(undefined);
    const emitLifecycle = vi.fn().mockResolvedValue(undefined);

    // The completion handler now drives lifecycle through the executions event
    // stream and the subagent_details satellite. Mirror the projector's status
    // flip and the satellite's result write onto the shared read-model object so
    // the subsequent checkStatus read reflects the terminal state.
    const detailsUpsert = vi
      .fn()
      .mockImplementation(async (details: SubagentDetailsUpsertArgs) => {
        if (details.result !== undefined) {
          execution.result = details.result;
        }
      });
    const executionCompleted = vi.fn().mockImplementation(async () => {
      execution.status = 'Completed';
      execution.completed_at = new Date('2026-01-01T00:05:00.000Z');
    });

    const subagentDetailsRepo = {
      upsert: detailsUpsert,
    } as unknown as SubagentDetailsRepository;

    const subagentReadModel = {
      findById: vi.fn().mockResolvedValue(execution),
    } as unknown as SubagentExecutionReadModel;

    const containerOrchestrator = {
      killContainer,
      removeContainer,
    } as unknown as ContainerOrchestratorService;

    const runnerConfigStore = {
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as RunnerConfigStoreService;

    const skillMounting = {
      cleanupSkillMount,
    } as unknown as SkillMountingService;

    const sessionHydration = {
      saveSessionForChat: vi.fn(),
    } as unknown as ChatSessionDomainPort;

    const chatSessionRepo = {
      update: vi.fn(),
    } as unknown as IChatSessionRepositoryPort;

    const meshDelegation = {
      handleSubagentCompletion,
      dispatchQueuedDelegations,
      handleSubagentCancellation: vi.fn(),
    } as unknown as MeshDelegationService;

    const parentResumeService = {
      resumeParentAfterSubagent,
    } as unknown as SubagentParentResumeService;

    const lifecycleEvents = {
      emit: emitLifecycle,
    } as unknown as SubagentLifecycleEventService;

    const parentLock = {
      runExclusive: vi.fn(async (_key: string, fn: () => Promise<unknown>) =>
        fn(),
      ),
    } as unknown as SubagentParentLockService;

    const provisioning = {
      spawn: vi.fn(),
    } as unknown as SubagentProvisioningService;

    const eventLedgerRepo = {
      findLatestTurnForStep: vi.fn(),
    } as unknown as EventLedgerRepository;

    const executionEventPublisher = {
      completed: executionCompleted,
    } as unknown as ExecutionEventPublisher;

    const runRepo = {
      findById: vi.fn().mockResolvedValue({ state_variables: {} }),
      setStateVariableAtomic: vi.fn().mockResolvedValue(undefined),
    } as unknown as IWorkflowRunRepository;

    const executionRepo = {
      findByContainerId: vi.fn().mockResolvedValue({ context_id: 'some-job' }),
    } as unknown as ExecutionRepository;

    const liveness = {
      isContainerLost: vi.fn().mockResolvedValue(false),
    } as unknown as SubagentContainerLivenessProbe;

    const service = new SubagentCoordinationService(
      subagentDetailsRepo,
      subagentReadModel,
      containerOrchestrator,
      runnerConfigStore,
      skillMounting,
      sessionHydration,
      chatSessionRepo,
      meshDelegation,
      parentResumeService,
      lifecycleEvents,
      parentLock,
      provisioning,
      eventLedgerRepo,
      executionEventPublisher,
      runRepo,
      executionRepo,
      liveness,
    );

    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const agentResponseStore = {
      store: vi.fn().mockResolvedValue(undefined),
      storeStepComplete: vi.fn().mockResolvedValue(undefined),
    };

    const turnEndPayload = {
      stepId: 'subagent-step-1',
      output: {
        response: '<think>tool call preamble</think>Need to call a tool first',
        stopReason: 'toolUse',
      },
    };

    const client = {
      role: 'agent',
      workflowRunId: 'workflow-run-1',
      stepId: 'subagent-step-1',
      isSubagent: true,
      subagentExecutionId: 'subagent-exec-1',
      jobId: 'job-1',
      containerId: 'parent-container-1',
    };

    await handleTurnEndGatewayCompat({
      client,
      payload: turnEndPayload,
      processAndBroadcastEvent,
      eventLedger,
      agentResponseStore: agentResponseStore as AgentResponseStoreService,
    });

    expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(1);
    expect(processAndBroadcastEvent).toHaveBeenCalledWith(
      'workflow-run-1',
      expect.objectContaining({
        event_type: 'turn_end',
      }),
    );
    expect(executionCompleted).not.toHaveBeenCalled();
    expect(execution.status).toBe('Running');
    expect(execution.result).toBeUndefined();
    expect(handleSubagentCompletion).not.toHaveBeenCalled();

    const completionPayload = {
      stepId: 'subagent-step-1',
      output: {
        response: '<think>analysis</think>Completed final response',
        stopReason: 'stop',
      },
    };

    await handleAgentEndGatewayCompat({
      client,
      payload: completionPayload,
      processAndBroadcastEvent,
      eventLedger,
      agentResponseStore: agentResponseStore as AgentResponseStoreService,
      subagentOrchestrator: service,
    });

    const status = await service.checkStatus(
      'parent-container-1',
      'subagent-exec-1',
      'workflow-run-1',
    );

    expect(status.status).toBe('Completed');
    expect(status.result).toEqual(
      expect.objectContaining({
        output: expect.objectContaining({
          response: 'Completed final response',
        }),
      }),
    );
    expect(status.latest_response).toBe('Completed final response');
    expect(status.latest_stop_reason).toBe('stop');
    expect(status.terminal).toBe(true);

    expect(killContainer).toHaveBeenCalledWith('child-container-1');
    expect(removeContainer).toHaveBeenCalledWith('child-container-1');
    expect(cleanupSkillMount).toHaveBeenCalledTimes(1);
    expect(executionCompleted).toHaveBeenCalledTimes(1);
  });
});
