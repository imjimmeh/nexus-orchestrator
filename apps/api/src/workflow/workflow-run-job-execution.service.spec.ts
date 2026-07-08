import { describe, expect, it, vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import {
  WORKFLOW_JOB_QUEUED_EVENT,
  WORKFLOW_RUN_ACTIVATED_FROM_QUEUE_EVENT,
  WORKFLOW_RUN_CANCELLED_EVENT,
} from './workflow-events.constants';
import { WorkflowRunJobExecutionService } from './workflow-run-job-execution.service';
import {
  tryActivateNextQueuedRun,
  enqueueTransitionJob,
} from './workflow-run-job-execution.utils';
import { JobCompletionHandler } from './job-completion.handler';
import { JobFailureHandler } from './job-failure.handler';

/**
 * Tests for the orchestration surface of `WorkflowRunJobExecutionService`.
 *
 * Both `handleJobComplete` and `handleJobFailed` are thin orchestrators that
 * delegate to extracted handlers:
 *   - `JobCompletionHandler` — success-path terminal-write trigger
 *   - `JobFailureHandler`    — failure-path terminal-write trigger
 *
 * Both are mocked here because the public service is a thin orchestrator on
 * both paths; tests that need to assert end-to-end completion or failure
 * semantics live next to the handlers (`job-completion.handler.spec.ts` and
 * `job-failure.handler.spec.ts`).
 *
 * The orchestration surface we still exercise here covers:
 *   - `enqueueJob` (queue + audit payload emission)
 *   - `enqueueTransitionJob` (skip-marking non-selected branches)
 *   - `tryActivateNextQueuedRun` (concurrency queue activation)
 *   - `cancelUnactivatablePendingRun`
 *   - delegation wiring of `handleJobComplete` and `handleJobFailed`
 */
describe('WorkflowRunJobExecutionService (orchestration surface)', () => {
  const createService = () => {
    const workflowRepo = {
      findById: vi.fn().mockResolvedValue(null),
      findByIdentifier: vi.fn().mockResolvedValue(null),
    };
    workflowRepo.findByIdentifier.mockImplementation((identifier: string) =>
      workflowRepo.findById(identifier),
    );
    const runRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'run-1',
        workflow_id: 'wf-1',
        status: 'RUNNING',
        state_variables: {},
      }),
      update: vi.fn().mockResolvedValue(undefined),
      findOldestPendingByScope: vi.fn().mockResolvedValue(null),
      setAwaitingInput: vi.fn().mockResolvedValue(undefined),
    };
    const stateManager = {
      getVariable: vi.fn().mockResolvedValue(null),
      getStateVariables: vi.fn().mockResolvedValue({}),
      setVariable: vi.fn().mockResolvedValue(undefined),
      deleteVariable: vi.fn().mockResolvedValue(undefined),
      tryMarkJobQueued: vi.fn(),
      tryMarkJobCompleted: vi.fn(),
      substituteTemplate: vi.fn((value: string) => value),
    };
    stateManager.tryMarkJobQueued.mockImplementation(
      async (workflowRunId: string, jobId: string) => {
        await stateManager.setVariable(
          workflowRunId,
          `_internal.queued_jobs.${jobId}`,
          true,
        );
        return true;
      },
    );
    const parser = {
      parseWorkflow: vi.fn().mockReturnValue({
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [],
      }),
    };
    const dagResolver = {
      buildDependencyGraph: vi.fn().mockReturnValue(new Map()),
      findParallelJobs: vi.fn().mockReturnValue([]),
    };
    const promptLoader = {
      resolveWorkflowPrompts: vi
        .fn()
        .mockImplementation((definition) => definition),
      resolveWorkflowPromptsWithRetry: vi
        .fn()
        .mockImplementation(async (definition) => definition),
    };
    const eventEmitter = { emit: vi.fn() };
    const stepQueue = {
      add: vi.fn().mockResolvedValue(undefined),
      getJobs: vi.fn().mockResolvedValue([]),
    };

    const jobCompletionHandler = {
      handle: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobCompletionHandler;

    const jobFailureHandler = {
      handle: vi.fn().mockResolvedValue('failed' as const),
    } as unknown as JobFailureHandler;

    const service = new WorkflowRunJobExecutionService(
      workflowRepo as never,
      runRepo as never,
      stateManager as never,
      dagResolver as never,
      parser as never,
      promptLoader as never,
      eventEmitter,
      stepQueue as never,
      jobCompletionHandler,
      jobFailureHandler,
    );

    return {
      service: service as unknown as {
        handleJobComplete: (
          workflowRunId: string,
          jobId: string,
          output: Record<string, unknown>,
        ) => Promise<void>;
        handleJobFailed: (
          workflowRunId: string,
          jobId: string,
          reason: string,
          resumeOverride?: {
            resumeSessionTreeId?: string;
            resumeSessionRef?: unknown;
          },
        ) => Promise<'ignored' | 'retry_scheduled' | 'failed' | 'salvaged'>;
        enqueueJob: (
          workflowRunId: string,
          def: unknown,
          jobId: string,
        ) => Promise<void>;
      },
      runRepo,
      stateManager,
      workflowRepo,
      parser,
      dagResolver,
      stepQueue,
      eventEmitter,
      jobCompletionHandler,
      jobFailureHandler,
    };
  };

  it('emits queued job audit payload with output contract metadata', async () => {
    const { service, eventEmitter, stepQueue } = createService();

    await service.enqueueJob(
      'run-1',
      {
        permissions: {
          allow_tools: ['read'],
          deny_tools: ['write'],
        },
        jobs: [
          {
            id: 'pm_refinement',
            type: 'execution',
            tier: 'heavy',
            depends_on: ['collect_context'],
            output_contract: {
              required: ['decision', 'summary'],
            },
            max_retries: 2,
            retry_prompt: 'Retry and submit preflight artifacts.',
            permissions: {
              allow_tools: ['set_job_output'],
              deny_tools: ['spawn_subagent_async'],
            },
          },
        ],
      },
      'pm_refinement',
    );

    expect(stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'pm_refinement',
      }),
      expect.objectContaining({
        jobId: 'workflow-step-run-1-pm_refinement',
      }),
    );

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_JOB_QUEUED_EVENT,
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'pm_refinement',
        payload: expect.objectContaining({
          outputContract: {
            required: ['decision', 'summary'],
          },
          maxRetries: 2,
          hasRetryPrompt: true,
          workflowToolPolicy: {
            allowTools: ['read'],
            denyTools: ['write'],
          },
          jobToolPolicy: {
            allowTools: ['set_job_output'],
            denyTools: ['spawn_subagent_async'],
          },
        }),
      }),
    );
  });

  it('marks non-selected transition branches as skipped', async () => {
    const { service, runRepo, stateManager } = createService();

    const enqueueJobSpy = vi
      .spyOn(service, 'enqueueJob')
      .mockResolvedValue(undefined);

    const definition = {
      jobs: [
        { id: 'review_resource' },
        { id: 'record_feedback_accept', depends_on: ['review_resource'] },
        { id: 'record_feedback_reject', depends_on: ['review_resource'] },
        {
          id: 'transition_to_ready_to_merge',
          depends_on: ['record_feedback_accept'],
        },
        {
          id: 'transition_to_in_progress',
          depends_on: ['record_feedback_reject'],
        },
        { id: 'resume_dev_session', depends_on: ['transition_to_in_progress'] },
      ],
    };

    await enqueueTransitionJob({
      workflowRunId: 'run-1',
      jobId: 'review_resource',
      nextJobId: 'record_feedback_reject',
      def: definition as any,
      runRepo: runRepo,
      stateManager: stateManager,
      enqueueJob: (runId, def, jobId) => service.enqueueJob(runId, def, jobId),
      logger: {
        warn: vi.fn(),
        log: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as never,
    });

    expect(stateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      '_internal.queued_jobs.record_feedback_accept',
      true,
    );
    expect(stateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      '_internal.completed_jobs.record_feedback_accept',
      true,
    );
    expect(stateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      '_internal.queued_jobs.transition_to_ready_to_merge',
      true,
    );
    expect(stateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      '_internal.completed_jobs.transition_to_ready_to_merge',
      true,
    );

    expect(runRepo.update).toHaveBeenCalledWith('run-1', {
      current_step_id: 'record_feedback_reject',
    });
    expect(enqueueJobSpy).toHaveBeenCalledWith(
      'run-1',
      definition,
      'record_feedback_reject',
    );
  });

  it('does not mark transition-reachable jobs as branch_not_selected', async () => {
    const { service, runRepo, stateManager } = createService();
    const enqueueJobSpy = vi
      .spyOn(service, 'enqueueJob')
      .mockResolvedValue(undefined);

    const definition = {
      jobs: [
        { id: 'parent' },
        { id: 'child_a', depends_on: ['parent'] },
        { id: 'child_b' },
        { id: 'grandchild', depends_on: ['child_b'] },
      ],
    };

    definition.jobs[1].transitions = [
      { condition: 'jobs.child_a.output.ok == false', next: 'child_b' },
    ];

    await enqueueTransitionJob({
      workflowRunId: 'run-1',
      jobId: 'parent',
      nextJobId: 'child_a',
      def: definition as any,
      runRepo,
      stateManager,
      enqueueJob: (runId, def, jobId) => service.enqueueJob(runId, def, jobId),
      logger: { debug: vi.fn() },
    });

    const skippedCalls = stateManager.setVariable.mock.calls.filter(
      ([_runId, key]: [string, string]) => key.includes('jobs.child_b.output'),
    );
    expect(skippedCalls).toHaveLength(0);

    const gcSkipped = stateManager.setVariable.mock.calls.filter(
      ([_runId, key]: [string, string]) =>
        key.includes('jobs.grandchild.output'),
    );
    expect(gcSkipped).toHaveLength(0);
  });

  describe('cancelUnactivatablePendingRun', () => {
    type CancelService = {
      cancelUnactivatablePendingRun: (
        runId: string,
        reason: string,
      ) => Promise<void>;
    };

    it('cancels a PENDING run and emits a cancelled event with the reason', async () => {
      const { service, runRepo, eventEmitter } = createService();
      runRepo.findById.mockResolvedValue({
        id: 'run-pending',
        workflow_id: 'wf-1',
        status: 'PENDING',
        state_variables: { trigger: { scopeId: 'scope-1' } },
      });

      await (service as unknown as CancelService).cancelUnactivatablePendingRun(
        'run-pending',
        'queued run can never activate',
      );

      expect(runRepo.update).toHaveBeenCalledWith(
        'run-pending',
        expect.objectContaining({ status: 'CANCELLED' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WORKFLOW_RUN_CANCELLED_EVENT,
        expect.objectContaining({
          workflowRunId: 'run-pending',
          workflowId: 'wf-1',
          status: 'CANCELLED',
          reason: 'queued run can never activate',
        }),
      );
    });

    it('is idempotent: does nothing when the run is no longer PENDING', async () => {
      const { service, runRepo, eventEmitter } = createService();
      runRepo.findById.mockResolvedValue({
        id: 'run-running',
        workflow_id: 'wf-1',
        status: 'RUNNING',
        state_variables: {},
      });

      await (service as unknown as CancelService).cancelUnactivatablePendingRun(
        'run-running',
        'queued run can never activate',
      );

      expect(runRepo.update).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('tryActivateNextQueuedRun', () => {
    it('returns a typed outcome describing why activation did not happen', async () => {
      const { service, workflowRepo, parser } = createService();

      workflowRepo.findById.mockResolvedValue({
        id: 'wf-1',
        yaml_definition: 'mock',
      });
      parser.parseWorkflow.mockReturnValue({
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [],
        concurrency: { max_runs: 1, on_conflict: 'skip' },
      });

      const outcome = await tryActivateNextQueuedRun(
        { workflow_id: 'wf-1', concurrency_scope: 'proj-1' },
        service as never,
      );

      expect(outcome).toEqual({
        activated: false,
        reason: 'concurrency_not_queue',
      });
    });

    it('returns activated:true with the run id when a pending run is activated', async () => {
      const { service, workflowRepo, parser, runRepo } = createService();

      workflowRepo.findById.mockResolvedValue({
        id: 'wf-1',
        yaml_definition: 'mock',
      });
      parser.parseWorkflow.mockReturnValue({
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [],
        concurrency: { max_runs: 1, on_conflict: 'queue' },
      });
      runRepo.findOldestPendingByScope.mockResolvedValue({
        id: 'run-pending-1',
        state_variables: { trigger: {} },
      });

      const outcome = await tryActivateNextQueuedRun(
        { workflow_id: 'wf-1', concurrency_scope: 'proj-1' },
        service as never,
      );

      expect(outcome).toEqual({ activated: true, runId: 'run-pending-1' });
    });

    it('does nothing when run has no concurrency_scope', async () => {
      const { service, runRepo } = createService();

      await tryActivateNextQueuedRun({ workflow_id: 'wf-1' }, service as never);

      expect(runRepo.findOldestPendingByScope).not.toHaveBeenCalled();
    });

    it('does nothing when workflow has no queue policy', async () => {
      const { service, workflowRepo, parser, runRepo } = createService();

      workflowRepo.findById.mockResolvedValue({
        id: 'wf-1',
        yaml_definition: 'mock',
      });
      parser.parseWorkflow.mockReturnValue({
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [],
        concurrency: { max_runs: 1, on_conflict: 'skip' },
      });

      await tryActivateNextQueuedRun(
        { workflow_id: 'wf-1', concurrency_scope: 'proj-1' },
        service as never,
      );

      expect(runRepo.findOldestPendingByScope).not.toHaveBeenCalled();
    });

    it('activates oldest pending run when queue policy and pending exists', async () => {
      const { service, workflowRepo, parser, runRepo, eventEmitter } =
        createService();

      workflowRepo.findById.mockResolvedValue({
        id: 'wf-1',
        yaml_definition: 'mock',
      });
      parser.parseWorkflow.mockReturnValue({
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [],
        concurrency: { max_runs: 1, on_conflict: 'queue' },
      });
      runRepo.findOldestPendingByScope.mockResolvedValue({
        id: 'run-pending-1',
        state_variables: { trigger: {} },
      });

      await tryActivateNextQueuedRun(
        { workflow_id: 'wf-1', concurrency_scope: 'proj-1' },
        service as never,
      );

      expect(runRepo.findOldestPendingByScope).toHaveBeenCalledWith(
        'wf-1',
        'proj-1',
      );
      expect(runRepo.update).toHaveBeenCalledWith(
        'run-pending-1',
        expect.objectContaining({ status: 'RUNNING' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WORKFLOW_RUN_ACTIVATED_FROM_QUEUE_EVENT,
        expect.objectContaining({
          workflowRunId: 'run-pending-1',
        }),
      );
    });

    it('loads legacy queued workflow values by identifier before activation', async () => {
      const { service, workflowRepo, parser, runRepo, eventEmitter } =
        createService();

      workflowRepo.findById.mockRejectedValue(
        new Error(
          'invalid input syntax for type uuid: "workflow_definition_id"',
        ),
      );
      workflowRepo.findByIdentifier.mockResolvedValue({
        id: 'wf-1',
        yaml_definition: 'mock',
      });
      parser.parseWorkflow.mockReturnValue({
        workflow_id: 'workflow_definition_id',
        name: 'Workflow Definition',
        jobs: [],
        concurrency: { max_runs: 1, on_conflict: 'queue' },
      });
      runRepo.findOldestPendingByScope.mockResolvedValue({
        id: 'run-pending-1',
        state_variables: { trigger: {} },
      });

      await tryActivateNextQueuedRun(
        { workflow_id: 'workflow_definition_id', concurrency_scope: 'scope-1' },
        service as never,
      );

      expect(workflowRepo.findByIdentifier).toHaveBeenCalledWith(
        'workflow_definition_id',
        { includeInactive: true },
      );
      expect(runRepo.findOldestPendingByScope).toHaveBeenCalledWith(
        'workflow_definition_id',
        'scope-1',
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WORKFLOW_RUN_ACTIVATED_FROM_QUEUE_EVENT,
        expect.objectContaining({
          workflowRunId: 'run-pending-1',
        }),
      );
    });

    it('does nothing when no pending runs exist', async () => {
      const { service, workflowRepo, parser, runRepo } = createService();

      workflowRepo.findById.mockResolvedValue({
        id: 'wf-1',
        yaml_definition: 'mock',
      });
      parser.parseWorkflow.mockReturnValue({
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [],
        concurrency: { max_runs: 1, on_conflict: 'skip' },
      });
      runRepo.findOldestPendingByScope.mockResolvedValue(null);

      await tryActivateNextQueuedRun(
        { workflow_id: 'wf-1', concurrency_scope: 'proj-1' },
        service as never,
      );

      expect(runRepo.update).not.toHaveBeenCalled();
    });
  });

  it('delegates handleJobComplete to JobCompletionHandler', async () => {
    const { service, jobCompletionHandler } = createService();

    await service.handleJobComplete('run-1', 'job-1', { ok: true });

    expect(jobCompletionHandler.handle).toHaveBeenCalledWith(
      'run-1',
      'job-1',
      { ok: true },
      expect.objectContaining({
        loadWorkflowDefinition: expect.any(Function),
        enqueueJob: expect.any(Function),
        reportMaxLoopIterations: expect.any(Function),
        tryActivateNextQueuedRun: expect.any(Function),
      }),
    );
  });

  it('delegates handleJobFailed to JobFailureHandler with shared deps', async () => {
    const { service, jobFailureHandler } = createService();
    (
      jobFailureHandler as unknown as { handle: ReturnType<typeof vi.fn> }
    ).handle.mockResolvedValue('retry_scheduled');

    const result = await service.handleJobFailed(
      'run-1',
      'job-1',
      'socket hang up',
      { resumeSessionTreeId: 'tree-1' },
    );

    expect(jobFailureHandler.handle).toHaveBeenCalledWith(
      'run-1',
      'job-1',
      'socket hang up',
      { resumeSessionTreeId: 'tree-1' },
      expect.objectContaining({
        loadWorkflowDefinition: expect.any(Function),
        completeJob: expect.any(Function),
        tryActivateNextQueuedRun: expect.any(Function),
      }),
    );
    expect(result).toBe('retry_scheduled');
  });

  it('routes handleJobFailed → completeJob back through handleJobComplete', async () => {
    const { service, jobCompletionHandler, jobFailureHandler } =
      createService();
    const failureMock = jobFailureHandler as unknown as {
      handle: ReturnType<typeof vi.fn>;
    };
    let capturedCompleteJob:
      | ((
          runId: string,
          jobId: string,
          output: Record<string, unknown>,
        ) => Promise<void>)
      | undefined;
    failureMock.handle.mockImplementation(
      (
        _runId: string,
        _jobId: string,
        _reason: string,
        _resume: unknown,
        deps: {
          completeJob: (
            runId: string,
            jobId: string,
            output: Record<string, unknown>,
          ) => Promise<void>;
        },
      ) => {
        capturedCompleteJob = deps.completeJob;
      },
    );

    await service.handleJobFailed('run-1', 'job-1', 'boom');

    expect(capturedCompleteJob).toBeDefined();
    await capturedCompleteJob!('run-1', 'job-1', { recovered: true });
    expect(jobCompletionHandler.handle).toHaveBeenCalledWith(
      'run-1',
      'job-1',
      { recovered: true },
      expect.objectContaining({
        loadWorkflowDefinition: expect.any(Function),
      }),
    );
  });
});
