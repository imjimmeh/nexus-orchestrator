/**
 * Integration test: idempotent step completion across the in-process awaiter
 * and the telemetry-driven StepCompletionFinalizerService.
 *
 * Scenario: both paths try to mark the same execution as completed for the
 * same (workflowRunId, contextId / jobId). The guard in
 * StepCompletionFinalizerService — checking for a running row before emitting —
 * must prevent the second emission, so workflowEngine.handleJobComplete is
 * called exactly once.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StepExecutionCompletionListener } from './step-execution-completion.listener';
import { StepCompletionFinalizerService } from './step-completion-finalizer.service';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import { ExecutionEventPublisher } from '../../execution-lifecycle/execution-event.publisher';
import { WorkflowRunJobExecutionService } from '../workflow-run-job-execution.service';
import { WORKFLOW_ENGINE_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import { LOCAL_DOMAIN_EVENT_FANOUT } from '../../domain-events/outbox-domain-event.bus';
import { EXECUTION_EVENT_TYPES } from '../../execution-lifecycle/execution-lifecycle.contracts';
import type { DomainEventEnvelope } from '../../domain-events/domain-event-bus.types';
import { StepEventPublisherService } from './step-event-publisher.service';
import { InterruptionRecoveryService } from '../workflow-interruption-recovery/interruption-recovery.service';

const RUN_ID = 'run-idempotency-1';
const JOB_ID = 'job-idempotency-1';
const EXEC_ID = 'exec-idempotency-1';

function makeCompletedEnvelope(): DomainEventEnvelope {
  return {
    eventId: 'evt-idempotency-1',
    eventType: EXECUTION_EVENT_TYPES.completed,
    aggregateId: EXEC_ID,
    aggregateType: 'execution',
    payload: {},
    occurredAt: new Date(),
  };
}

/**
 * Builds a running-state execution record as the listener's repo would return
 * before the first completion is applied.
 */
function makeRunningExecution() {
  return {
    id: EXEC_ID,
    kind: 'workflow_step' as const,
    state: 'running' as const,
    workflow_run_id: RUN_ID,
    context_id: JOB_ID,
    container_id: null,
    container_tier: 2,
  };
}

describe('step completion idempotency — awaiter + telemetry finalizer', () => {
  // In-process bus: collect handlers so tests can fire events directly
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

  async function emitOnBus(
    eventType: string,
    envelope: DomainEventEnvelope,
  ): Promise<void> {
    for (const handler of busHandlers[eventType] ?? []) {
      await handler(envelope);
    }
  }

  let listener: StepExecutionCompletionListener;
  let finalizer: StepCompletionFinalizerService;

  let executionRepo: {
    findById: ReturnType<typeof vi.fn>;
    findByWorkflowRunAndJob: ReturnType<typeof vi.fn>;
    findRunningStepByRunAndContext: ReturnType<typeof vi.fn>;
  };
  let workflowEngine: { handleJobComplete: ReturnType<typeof vi.fn> };
  let publisher: {
    completed: ReturnType<typeof vi.fn>;
    failed: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(busHandlers).forEach((k) => {
      busHandlers[k] = [];
    });

    executionRepo = {
      findById: vi.fn(),
      findByWorkflowRunAndJob: vi.fn().mockResolvedValue([]),
      findRunningStepByRunAndContext: vi.fn(),
    };

    workflowEngine = {
      handleJobComplete: vi.fn().mockResolvedValue(undefined),
    };

    publisher = {
      completed: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StepExecutionCompletionListener,
        StepCompletionFinalizerService,
        { provide: LOCAL_DOMAIN_EVENT_FANOUT, useValue: bus },
        { provide: ExecutionRepository, useValue: executionRepo },
        {
          provide: WorkflowRunJobExecutionService,
          useValue: { handleJobFailed: vi.fn().mockResolvedValue(undefined) },
        },
        { provide: WORKFLOW_ENGINE_SERVICE, useValue: workflowEngine },
        {
          provide: StepEventPublisherService,
          useValue: {
            publishProcessEvent: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: InterruptionRecoveryService,
          useValue: {
            prepareRecovery: vi.fn().mockResolvedValue({
              cancelledSubagentExecutions: [],
              parentResume: undefined,
            }),
          },
        },
        {
          provide: ExecutionEventPublisher,
          useValue: publisher,
        },
      ],
    }).compile();

    listener = module.get(StepExecutionCompletionListener);
    finalizer = module.get(StepCompletionFinalizerService);
    listener.onModuleInit();
  });

  it('advances the workflow exactly once when execution.completed fires twice for the same execution', async () => {
    // The listener's repo returns the running execution on the FIRST call (in-process
    // awaiter path), then returns the completed execution on the SECOND call (simulating
    // that the row has been transitioned after the first emission applied).
    executionRepo.findById
      .mockResolvedValueOnce(makeRunningExecution())
      .mockResolvedValueOnce({ ...makeRunningExecution(), state: 'completed' });

    // First emission: the in-process awaiter fires execution.completed.
    // The listener resolves the (running) execution, sees it is not superseded,
    // and calls handleJobComplete once.
    await emitOnBus(EXECUTION_EVENT_TYPES.completed, makeCompletedEnvelope());

    expect(workflowEngine.handleJobComplete).toHaveBeenCalledOnce();
    expect(workflowEngine.handleJobComplete).toHaveBeenCalledWith(
      RUN_ID,
      JOB_ID,
      { executionId: EXEC_ID, ok: true },
    );

    // Second path: the telemetry StepCompletionFinalizerService runs.
    // findRunningStepByRunAndContext returns null because the awaiter already
    // transitioned the row — no running step exists anymore.
    executionRepo.findRunningStepByRunAndContext.mockResolvedValue(null);

    const result = await finalizer.finalizeFromAgentEnd({
      workflowRunId: RUN_ID,
      contextId: JOB_ID,
      hasFailure: false,
    });

    // The finalizer must short-circuit: no event emitted, finalized=false.
    expect(result).toEqual({ finalized: false });
    expect(publisher.completed).not.toHaveBeenCalled();

    // Crucially: handleJobComplete must still be called exactly once in total —
    // the second finalizer path was a no-op so no second emission reached the listener.
    expect(workflowEngine.handleJobComplete).toHaveBeenCalledOnce();
  });

  it('advances the workflow exactly once in the HARD ordering: telemetry finalizer emits first, then the awaiter emits a second completion on the already-terminal row', async () => {
    // Hard ordering — the race the easy test does NOT cover:
    //   1. The telemetry StepCompletionFinalizerService reads a STILL-RUNNING row
    //      (findRunningStepByRunAndContext returns it) and emits execution.completed.
    //   2. That first event reaches the listener, which advances the workflow once
    //      (the row is still 'running' at that point).
    //   3. The projector then advances the row to the terminal 'completed' state.
    //   4. The in-process awaiter ALSO emits execution.completed for the same id.
    //      The listener reads the row back as 'completed' (terminal, NOT 'cancelled'),
    //      so the superseded-guard does not catch it — only the new already-terminal
    //      guard does, making the second advance a no-op.

    // Step 1: finalizer finds a running row and emits the first completion.
    executionRepo.findRunningStepByRunAndContext.mockResolvedValue(
      makeRunningExecution(),
    );
    // Step 2: the listener resolves the row as 'running' for the first event.
    executionRepo.findById.mockResolvedValueOnce(makeRunningExecution());

    const result = await finalizer.finalizeFromAgentEnd({
      workflowRunId: RUN_ID,
      contextId: JOB_ID,
      hasFailure: false,
    });
    expect(result).toEqual({ finalized: true, executionId: EXEC_ID });
    expect(publisher.completed).toHaveBeenCalledWith(EXEC_ID);

    // The finalizer's publisher is mocked, so drive its emitted event onto the bus
    // to model it reaching the listener.
    await emitOnBus(EXECUTION_EVENT_TYPES.completed, makeCompletedEnvelope());
    expect(workflowEngine.handleJobComplete).toHaveBeenCalledOnce();

    // Steps 3 & 4: the projector has advanced the row to terminal 'completed', and
    // the awaiter now emits its OWN execution.completed for the same execution id.
    executionRepo.findById.mockResolvedValueOnce({
      ...makeRunningExecution(),
      state: 'completed',
    });
    await emitOnBus(EXECUTION_EVENT_TYPES.completed, makeCompletedEnvelope());

    // The Part A already-terminal guard must suppress the second advance.
    expect(workflowEngine.handleJobComplete).toHaveBeenCalledOnce();
  });
});
