import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StepExecutionCompletionListener } from './step-execution-completion.listener';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import { WorkflowRunJobExecutionService } from '../workflow-run-job-execution.service';
import { WORKFLOW_ENGINE_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import { LOCAL_DOMAIN_EVENT_FANOUT } from '../../domain-events/outbox-domain-event.bus';
import { EXECUTION_EVENT_TYPES } from '../../execution-lifecycle/execution-lifecycle.contracts';
import type { DomainEventEnvelope } from '../../domain-events/domain-event-bus.types';
import { StepEventPublisherService } from './step-event-publisher.service';
import { InterruptionRecoveryService } from '../workflow-interruption-recovery/interruption-recovery.service';

function makeEnvelope(
  eventType: string,
  aggregateId: string,
  payload: Record<string, unknown> = {},
): DomainEventEnvelope {
  return {
    eventId: 'evt-1',
    eventType,
    aggregateId,
    aggregateType: 'execution',
    payload,
    occurredAt: new Date(),
  };
}

describe('StepExecutionCompletionListener', () => {
  let listener: StepExecutionCompletionListener;
  let executionRepo: {
    findById: ReturnType<typeof vi.fn>;
    findByWorkflowRunAndJob: ReturnType<typeof vi.fn>;
  };
  let runJobExecution: {
    handleJobFailed: ReturnType<typeof vi.fn>;
  };
  let workflowEngine: {
    handleJobComplete: ReturnType<typeof vi.fn>;
  };
  let stepEventPublisher: {
    publishProcessEvent: ReturnType<typeof vi.fn>;
  };
  let interruptionRecovery: {
    prepareRecovery: ReturnType<typeof vi.fn>;
  };

  // Capture handlers registered via bus.on()
  const busHandlers: Record<
    string,
    Array<(e: DomainEventEnvelope) => Promise<void>>
  > = {};
  const bus = {
    on: vi.fn(
      (
        eventType: string,
        handler: (e: DomainEventEnvelope) => Promise<void>,
      ) => {
        if (!busHandlers[eventType]) {
          busHandlers[eventType] = [];
        }
        busHandlers[eventType].push(handler);
      },
    ),
  };

  async function emit(
    eventType: string,
    envelope: DomainEventEnvelope,
  ): Promise<void> {
    for (const handler of busHandlers[eventType] ?? []) {
      await handler(envelope);
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(busHandlers).forEach((k) => {
      busHandlers[k] = [];
    });

    executionRepo = {
      findById: vi.fn(),
      findByWorkflowRunAndJob: vi.fn().mockResolvedValue([]),
    };
    runJobExecution = {
      handleJobFailed: vi.fn().mockResolvedValue(undefined),
    };
    workflowEngine = {
      handleJobComplete: vi.fn().mockResolvedValue(undefined),
    };
    stepEventPublisher = {
      publishProcessEvent: vi.fn().mockResolvedValue(undefined),
    };
    interruptionRecovery = {
      prepareRecovery: vi.fn().mockResolvedValue({
        cancelledSubagentExecutions: [],
        parentResume: undefined,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StepExecutionCompletionListener,
        { provide: LOCAL_DOMAIN_EVENT_FANOUT, useValue: bus },
        { provide: ExecutionRepository, useValue: executionRepo },
        { provide: WorkflowRunJobExecutionService, useValue: runJobExecution },
        { provide: WORKFLOW_ENGINE_SERVICE, useValue: workflowEngine },
        { provide: StepEventPublisherService, useValue: stepEventPublisher },
        {
          provide: InterruptionRecoveryService,
          useValue: interruptionRecovery,
        },
      ],
    }).compile();

    listener = module.get(StepExecutionCompletionListener);
    listener.onModuleInit();
  });

  it('is defined', () => {
    expect(listener).toBeDefined();
  });

  it('registers handlers for completed, failed, and reaped events on init', () => {
    expect(bus.on).toHaveBeenCalledWith(
      EXECUTION_EVENT_TYPES.completed,
      expect.any(Function),
    );
    expect(bus.on).toHaveBeenCalledWith(
      EXECUTION_EVENT_TYPES.failed,
      expect.any(Function),
    );
    expect(bus.on).toHaveBeenCalledWith(
      EXECUTION_EVENT_TYPES.reaped,
      expect.any(Function),
    );
  });

  describe('execution.completed', () => {
    it('calls workflowEngine.handleJobComplete for workflow_step executions', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-1',
        kind: 'workflow_step',
        state: 'running',
        workflow_run_id: 'run-1',
        context_id: 'job-1',
      });

      await emit(
        EXECUTION_EVENT_TYPES.completed,
        makeEnvelope(EXECUTION_EVENT_TYPES.completed, 'exec-1'),
      );

      expect(workflowEngine.handleJobComplete).toHaveBeenCalledWith(
        'run-1',
        'job-1',
        { executionId: 'exec-1', ok: true },
      );
      expect(runJobExecution.handleJobFailed).not.toHaveBeenCalled();
    });

    it('ignores executions that are not workflow_step', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-2',
        kind: 'subagent',
        workflow_run_id: 'run-1',
        context_id: null,
      });

      await emit(
        EXECUTION_EVENT_TYPES.completed,
        makeEnvelope(EXECUTION_EVENT_TYPES.completed, 'exec-2'),
      );

      expect(workflowEngine.handleJobComplete).not.toHaveBeenCalled();
    });

    it('ignores executions that are not found', async () => {
      executionRepo.findById.mockResolvedValueOnce(null);

      await emit(
        EXECUTION_EVENT_TYPES.completed,
        makeEnvelope(EXECUTION_EVENT_TYPES.completed, 'exec-missing'),
      );

      expect(workflowEngine.handleJobComplete).not.toHaveBeenCalled();
    });

    it('ignores workflow_step executions missing workflow_run_id', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-3',
        kind: 'workflow_step',
        workflow_run_id: null,
        context_id: 'job-1',
      });

      await emit(
        EXECUTION_EVENT_TYPES.completed,
        makeEnvelope(EXECUTION_EVENT_TYPES.completed, 'exec-3'),
      );

      expect(workflowEngine.handleJobComplete).not.toHaveBeenCalled();
    });

    it('ignores workflow_step executions missing context_id (jobId)', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-4',
        kind: 'workflow_step',
        workflow_run_id: 'run-1',
        context_id: null,
      });

      await emit(
        EXECUTION_EVENT_TYPES.completed,
        makeEnvelope(EXECUTION_EVENT_TYPES.completed, 'exec-4'),
      );

      expect(workflowEngine.handleJobComplete).not.toHaveBeenCalled();
    });

    it('does NOT advance the workflow for a superseded (cancelled) execution', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-old',
        kind: 'workflow_step',
        state: 'cancelled',
        failure_reason: 'superseded',
        workflow_run_id: 'run-1',
        context_id: 'job-1',
      });

      await emit(
        EXECUTION_EVENT_TYPES.completed,
        makeEnvelope(EXECUTION_EVENT_TYPES.completed, 'exec-old'),
      );

      expect(workflowEngine.handleJobComplete).not.toHaveBeenCalled();
    });

    it('does NOT advance the workflow for an already-completed (terminal) execution', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-terminal',
        kind: 'workflow_step',
        state: 'completed',
        workflow_run_id: 'run-1',
        context_id: 'job-1',
      });

      await emit(
        EXECUTION_EVENT_TYPES.completed,
        makeEnvelope(EXECUTION_EVENT_TYPES.completed, 'exec-terminal'),
      );

      expect(workflowEngine.handleJobComplete).not.toHaveBeenCalled();
    });

    it('advances the workflow when the execution is still completing', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-completing',
        kind: 'workflow_step',
        state: 'completing',
        workflow_run_id: 'run-1',
        context_id: 'job-1',
      });

      await emit(
        EXECUTION_EVENT_TYPES.completed,
        makeEnvelope(EXECUTION_EVENT_TYPES.completed, 'exec-completing'),
      );

      expect(workflowEngine.handleJobComplete).toHaveBeenCalledOnce();
    });

    it('does not rethrow when handleJobComplete throws', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-5',
        kind: 'workflow_step',
        state: 'running',
        workflow_run_id: 'run-1',
        context_id: 'job-1',
      });
      workflowEngine.handleJobComplete.mockRejectedValueOnce(
        new Error('engine error'),
      );

      await expect(
        emit(
          EXECUTION_EVENT_TYPES.completed,
          makeEnvelope(EXECUTION_EVENT_TYPES.completed, 'exec-5'),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('execution.failed', () => {
    it('calls runJobExecution.handleJobFailed for workflow_step executions', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-6',
        kind: 'workflow_step',
        workflow_run_id: 'run-2',
        context_id: 'job-2',
      });

      await emit(
        EXECUTION_EVENT_TYPES.failed,
        makeEnvelope(EXECUTION_EVENT_TYPES.failed, 'exec-6', {
          failure_reason: 'agent_error',
          error_message: 'step crashed',
        }),
      );

      expect(runJobExecution.handleJobFailed).toHaveBeenCalledWith(
        'run-2',
        'job-2',
        'step crashed',
        undefined,
      );
      expect(workflowEngine.handleJobComplete).not.toHaveBeenCalled();
    });

    it('uses a fallback message when error_message is absent from payload', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-7',
        kind: 'workflow_step',
        workflow_run_id: 'run-2',
        context_id: 'job-2',
      });

      await emit(
        EXECUTION_EVENT_TYPES.failed,
        makeEnvelope(EXECUTION_EVENT_TYPES.failed, 'exec-7'),
      );

      expect(runJobExecution.handleJobFailed).toHaveBeenCalledWith(
        'run-2',
        'job-2',
        expect.stringContaining('exec-7'),
        undefined,
      );
    });

    it('does NOT call handleJobFailed for a superseded (cancelled) execution', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-old',
        kind: 'workflow_step',
        state: 'cancelled',
        failure_reason: 'superseded',
        workflow_run_id: 'run-2',
        context_id: 'job-2',
      });

      await emit(
        EXECUTION_EVENT_TYPES.failed,
        makeEnvelope(EXECUTION_EVENT_TYPES.failed, 'exec-old', {
          failure_reason: 'agent_error',
          error_message: 'socket hang up',
        }),
      );

      expect(runJobExecution.handleJobFailed).not.toHaveBeenCalled();
    });

    it('ignores non-workflow_step failed executions', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-8',
        kind: 'adhoc_chat',
        workflow_run_id: null,
        context_id: null,
      });

      await emit(
        EXECUTION_EVENT_TYPES.failed,
        makeEnvelope(EXECUTION_EVENT_TYPES.failed, 'exec-8'),
      );

      expect(runJobExecution.handleJobFailed).not.toHaveBeenCalled();
    });
  });

  describe('execution.reaped', () => {
    it('calls runJobExecution.handleJobFailed for reaped workflow_step executions', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-9',
        kind: 'workflow_step',
        workflow_run_id: 'run-3',
        context_id: 'job-3',
        container_id: 'container-3',
        container_tier: 2,
      });

      await emit(
        EXECUTION_EVENT_TYPES.reaped,
        makeEnvelope(EXECUTION_EVENT_TYPES.reaped, 'exec-9', {
          failure_reason: 'idle_timeout',
          error_message: 'container idle timeout',
        }),
      );

      expect(runJobExecution.handleJobFailed).toHaveBeenCalledWith(
        'run-3',
        'job-3',
        'container idle timeout',
        undefined,
      );
    });

    it('does NOT call handleJobFailed when the job already has a completed execution', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-stale',
        kind: 'workflow_step',
        workflow_run_id: 'run-c',
        context_id: 'job-c',
      });
      executionRepo.findByWorkflowRunAndJob.mockResolvedValueOnce([
        {
          id: 'exec-done',
          kind: 'workflow_step',
          state: 'completed',
          workflow_run_id: 'run-c',
          context_id: 'job-c',
        },
      ]);

      await emit(
        EXECUTION_EVENT_TYPES.reaped,
        makeEnvelope(EXECUTION_EVENT_TYPES.reaped, 'exec-stale', {
          failure_reason: 'idle_timeout',
          error_message: 'No activity heartbeat within the idle timeout window',
        }),
      );

      expect(runJobExecution.handleJobFailed).not.toHaveBeenCalled();
    });

    it('publishes execution.reaped process event to telemetry when workflow_step is reaped', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-9',
        kind: 'workflow_step',
        workflow_run_id: 'run-3',
        context_id: 'job-3',
        state: 'running',
      });
      executionRepo.findByWorkflowRunAndJob.mockResolvedValueOnce([]);

      await emit(
        EXECUTION_EVENT_TYPES.reaped,
        makeEnvelope(EXECUTION_EVENT_TYPES.reaped, 'exec-9', {
          failure_reason: 'container_lost',
          error_message: 'Container was lost',
        }),
      );

      expect(stepEventPublisher.publishProcessEvent).toHaveBeenCalledWith(
        'run-3',
        'execution.reaped',
        expect.objectContaining({
          executionId: 'exec-9',
          failure_reason: 'container_lost',
        }),
      );
    });

    it('does NOT publish telemetry when execution is not a workflow_step', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-chat',
        kind: 'chat',
        workflow_run_id: null,
        context_id: null,
        state: 'running',
      });

      await emit(
        EXECUTION_EVENT_TYPES.reaped,
        makeEnvelope(EXECUTION_EVENT_TYPES.reaped, 'exec-chat', {
          failure_reason: 'idle_timeout',
        }),
      );

      expect(stepEventPublisher.publishProcessEvent).not.toHaveBeenCalled();
    });

    it('still calls handleJobFailed when no completed execution exists', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-stuck',
        kind: 'workflow_step',
        workflow_run_id: 'run-d',
        context_id: 'job-d',
        container_id: 'container-d',
        container_tier: 2,
      });
      executionRepo.findByWorkflowRunAndJob.mockResolvedValueOnce([
        {
          id: 'exec-stuck',
          kind: 'workflow_step',
          state: 'running',
          workflow_run_id: 'run-d',
          context_id: 'job-d',
        },
      ]);

      await emit(
        EXECUTION_EVENT_TYPES.reaped,
        makeEnvelope(EXECUTION_EVENT_TYPES.reaped, 'exec-stuck', {
          failure_reason: 'idle_timeout',
          error_message: 'No activity heartbeat',
        }),
      );

      expect(runJobExecution.handleJobFailed).toHaveBeenCalledWith(
        'run-d',
        'job-d',
        'No activity heartbeat',
        undefined,
      );
    });

    it('calls InterruptionRecoveryService.prepareRecovery for execution.reaped with supervisor-reap source', async () => {
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-reap',
        kind: 'workflow_step',
        workflow_run_id: 'run-r',
        context_id: 'job-r',
        container_id: 'container-r-1',
        container_tier: 2,
        state: 'running',
      });
      executionRepo.findByWorkflowRunAndJob.mockResolvedValueOnce([]);

      await emit(
        EXECUTION_EVENT_TYPES.reaped,
        makeEnvelope(EXECUTION_EVENT_TYPES.reaped, 'exec-reap', {
          failure_reason: 'idle_timeout',
          error_message: 'container idle timeout',
        }),
      );

      expect(interruptionRecovery.prepareRecovery).toHaveBeenCalledWith({
        workflowRunId: 'run-r',
        jobId: 'job-r',
        parentContainerIds: new Set(['container-r-1']),
        source: 'supervisor-reap',
        containerTier: 2,
        parentExecutionId: 'exec-reap',
      });
    });

    it('threads parentResume from InterruptionRecoveryService into handleJobFailed for reaped events', async () => {
      const mockParentResume = {
        resumeSessionTreeId: 'tree-parent',
        resumeSessionRef: {
          kind: 'pi',
          treeId: 'tree-parent',
          resumeNodeId: 'n1',
        } as const,
      };
      interruptionRecovery.prepareRecovery.mockResolvedValueOnce({
        cancelledSubagentExecutions: [{ executionId: 'exec-1' }],
        parentResume: mockParentResume,
      });

      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-reap2',
        kind: 'workflow_step',
        workflow_run_id: 'run-r2',
        context_id: 'job-r2',
        container_id: 'container-r-2',
        container_tier: 2,
        state: 'running',
      });
      executionRepo.findByWorkflowRunAndJob.mockResolvedValueOnce([]);

      await emit(
        EXECUTION_EVENT_TYPES.reaped,
        makeEnvelope(EXECUTION_EVENT_TYPES.reaped, 'exec-reap2', {
          failure_reason: 'idle_timeout',
          error_message: 'container idle timeout',
        }),
      );

      expect(runJobExecution.handleJobFailed).toHaveBeenCalledWith(
        'run-r2',
        'job-r2',
        'container idle timeout',
        mockParentResume,
      );
    });

    it('routes stale owner lease idle-timeout reaps through recovery before retrying the job', async () => {
      const parentResume = {
        resumeSessionTreeId: 'tree-stale-owner',
        resumeSessionRef: {
          kind: 'pi',
          treeId: 'tree-stale-owner',
          resumeNodeId: 'node-stale-owner',
        } as const,
      };
      interruptionRecovery.prepareRecovery.mockResolvedValueOnce({
        cancelledSubagentExecutions: [],
        parentResume,
      });
      executionRepo.findById.mockResolvedValueOnce({
        id: 'exec-stale-owner',
        kind: 'workflow_step',
        workflow_run_id: 'run-stale-owner',
        context_id: 'job-stale-owner',
        container_id: 'container-stale-owner',
        container_tier: 2,
        state: 'running',
        failure_reason: 'idle_timeout',
      });
      executionRepo.findByWorkflowRunAndJob.mockResolvedValueOnce([]);

      await emit(
        EXECUTION_EVENT_TYPES.reaped,
        makeEnvelope(EXECUTION_EVENT_TYPES.reaped, 'exec-stale-owner', {
          failure_reason: 'idle_timeout',
          error_message: 'Owner lease expired after quiescent job activity',
        }),
      );

      expect(interruptionRecovery.prepareRecovery).toHaveBeenCalledWith({
        workflowRunId: 'run-stale-owner',
        jobId: 'job-stale-owner',
        parentContainerIds: new Set(['container-stale-owner']),
        source: 'supervisor-reap',
        containerTier: 2,
        parentExecutionId: 'exec-stale-owner',
      });
      expect(runJobExecution.handleJobFailed).toHaveBeenCalledWith(
        'run-stale-owner',
        'job-stale-owner',
        'Owner lease expired after quiescent job activity',
        parentResume,
      );
    });
  });
});
