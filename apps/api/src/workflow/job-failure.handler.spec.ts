import { describe, expect, it, vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import {
  WORKFLOW_RUN_FAILED_EVENT,
  WORKFLOW_RUN_RETRY_SCHEDULED_EVENT,
} from './workflow-events.constants';
import { JobFailureHandler } from './job-failure.handler';
import type { JobFailureHandlerDeps } from './job-failure.handler.types';
import type { AgentRetryResume } from './job-execution.types';
import { autoRetryLastFailurePath } from './workflow-run-retry-state.helpers';

/**
 * Tests for the extracted `JobFailureHandler`.
 *
 * These cover the same failure-path scenarios that used to live inline in
 * `WorkflowRunJobExecutionService.handleJobFailed`. The public service is
 * now a thin orchestrator that delegates here; this suite pins the behavior
 * that the delegation must preserve.
 *
 * The handler is exercised directly (no NestJS testing module) so the
 * collaborator contracts and the per-call dependency bag stay first-class.
 */
describe('JobFailureHandler', () => {
  const createHandler = (options?: { autoRetryEnabled?: boolean }) => {
    const workflowRun = (over: Record<string, unknown> = {}) => ({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.RUNNING,
      awaiting_input: false,
      wait_reason: null,
      state_variables: {},
      ...over,
    });
    const runRepo = {
      findById: vi.fn().mockResolvedValue(workflowRun()),
      update: vi.fn().mockResolvedValue(undefined),
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
    const eventEmitter = { emit: vi.fn() };
    const stepQueue = {
      add: vi.fn().mockResolvedValue(undefined),
      getJobs: vi.fn().mockResolvedValue([]),
    };
    const systemSettings = {
      get: vi
        .fn()
        .mockImplementation(async (key: string, defaultValue: unknown) => {
          if (key === 'workflow_auto_retry_enabled') {
            return options?.autoRetryEnabled ?? false;
          }
          return defaultValue;
        }),
    };
    const terminalRunCloser = {
      closeFailedRun: vi.fn().mockResolvedValue({
        removedJobs: 0,
        stoppedContainers: 0,
      }),
    };
    const sessionHydration = {
      findSessionTreeByWorkflowRunId: vi.fn().mockResolvedValue(null),
    };
    const questionPark = {
      isIdleQuestionTeardownTimeout: vi.fn().mockResolvedValue(false),
      clearOrphanedQuestionStateOnRetry: vi.fn().mockResolvedValue(undefined),
    };

    const handler = new JobFailureHandler(
      runRepo as never,
      stateManager as never,
      eventEmitter,
      stepQueue as never,
      systemSettings as never,
      terminalRunCloser as never,
      sessionHydration as never,
      questionPark as never,
    );

    const loadWorkflowDefinition = vi
      .fn()
      .mockImplementation(async (workflowId: string) => ({
        workflow_id: workflowId,
        name: 'WF',
        jobs: [],
      }));
    const completeJob = vi.fn().mockResolvedValue(undefined);
    const tryActivateNextQueuedRun = vi.fn().mockResolvedValue({
      activated: false,
      reason: 'no_concurrency_scope',
    });

    const deps: JobFailureHandlerDeps = {
      loadWorkflowDefinition,
      completeJob,
      tryActivateNextQueuedRun,
    };

    return {
      handler,
      runRepo,
      workflowRun,
      stateManager,
      eventEmitter,
      stepQueue,
      systemSettings,
      terminalRunCloser,
      sessionHydration,
      questionPark,
      loadWorkflowDefinition,
      completeJob,
      tryActivateNextQueuedRun,
      call: (
        workflowRunId: string,
        jobId: string,
        reason: string,
        resumeOverride?: AgentRetryResume,
      ) => handler.handle(workflowRunId, jobId, reason, resumeOverride, deps),
    };
  };

  it('returns "ignored" when the run cannot be found', async () => {
    const { call, runRepo } = createHandler();
    runRepo.findById.mockResolvedValue(null);

    const result = await call('run-1', 'job-1', 'boom');

    expect(result).toBe('ignored');
  });

  it('returns "ignored" when the run is not RUNNING', async () => {
    const { call, runRepo } = createHandler();
    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.COMPLETED,
      state_variables: {},
    });

    const result = await call('run-1', 'job-1', 'boom');

    expect(result).toBe('ignored');
  });

  it('marks workflow run failed when a job exhausts retries', async () => {
    const { call, runRepo } = createHandler();

    const result = await call('run-1', 'transition_to_ready_to_merge', 'boom');

    expect(runRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(result).toBe('failed');
  });

  it('stamps completed_at when a run fails', async () => {
    const { call, runRepo } = createHandler();

    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.RUNNING,
      started_at: new Date('2026-06-19T09:00:00.000Z'),
      completed_at: null,
      state_variables: {},
    });

    await call('run-1', 'transition_to_ready_to_merge', 'boom');

    const failingUpdate = runRepo.update.mock.calls.find(
      ([, data]: [string, Record<string, unknown>]) =>
        data.status === WorkflowStatus.FAILED,
    );
    expect(failingUpdate?.[1].completed_at).toBeInstanceOf(Date);
  });

  it('does not overwrite completed_at when failing a run that already has one', async () => {
    const { call, runRepo } = createHandler();

    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.RUNNING,
      started_at: new Date('2026-06-19T09:00:00.000Z'),
      completed_at: new Date('2026-06-19T10:00:00.000Z'),
      state_variables: {},
    });

    await call('run-1', 'transition_to_ready_to_merge', 'boom');

    const failingUpdate = runRepo.update.mock.calls.find(
      ([, data]: [string, Record<string, unknown>]) =>
        data.status === WorkflowStatus.FAILED,
    );
    expect(failingUpdate?.[1]).not.toHaveProperty('completed_at');
  });

  it('clears stale auto-retry state when a job exhausts retries and fails', async () => {
    const { call, stateManager } = createHandler();

    await call('run-1', 'transition_to_ready_to_merge', 'boom');

    expect(stateManager.deleteVariable).toHaveBeenCalledWith(
      'run-1',
      '_internal.auto_retry.transition_to_ready_to_merge',
    );
  });

  it('emits WORKFLOW_RUN_FAILED_EVENT with the failed job id and reason', async () => {
    const { call, eventEmitter } = createHandler();

    await call(
      'run-1',
      'transition_to_ready_to_merge',
      'Step transition_to_ready_to_merge: refinement exit readiness failed for work item work-1: missing_subtasks',
    );

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_FAILED_EVENT,
      expect.objectContaining({
        workflowRunId: 'run-1',
        status: WorkflowStatus.FAILED,
        failedJobId: 'transition_to_ready_to_merge',
        errorMessage: expect.stringContaining(
          'job_failed_after_retries: Step transition_to_ready_to_merge',
        ),
      }),
    );
  });

  it('closes the failed run via the terminal run closer before activating queued runs', async () => {
    const { call, terminalRunCloser, tryActivateNextQueuedRun } =
      createHandler();

    await call('run-1', 'transition_to_ready_to_merge', 'boom');

    expect(terminalRunCloser.closeFailedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        workflowId: 'wf-1',
        failedJobId: 'transition_to_ready_to_merge',
        reason: 'job_failed_after_retries: boom',
      }),
    );
    expect(tryActivateNextQueuedRun).toHaveBeenCalledTimes(1);
  });

  it('schedules provider rate limit auto-retry even when generic workflow auto-retry is disabled', async () => {
    const {
      call,
      runRepo,
      loadWorkflowDefinition,
      stateManager,
      stepQueue,
      eventEmitter,
      systemSettings,
    } = createHandler({ autoRetryEnabled: false });

    systemSettings.get.mockImplementation(
      async (key: string, defaultValue: unknown) => {
        const overrides: Record<string, unknown> = {
          workflow_auto_retry_enabled: false,
          workflow_auto_retry_max_attempts: 3,
          workflow_auto_retry_initial_delay_ms: 60000,
          workflow_auto_retry_max_delay_ms: 300000,
          workflow_auto_retry_backoff_multiplier: 2,
          workflow_auto_retry_jitter_ratio: 0,
          workflow_auto_retry_max_in_flight: 5,
        };

        return key in overrides ? overrides[key] : defaultValue;
      },
    );
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'transition_to_ready_to_merge' }],
    });
    stateManager.getVariable.mockResolvedValue(0);

    const result = await call(
      'run-1',
      'transition_to_ready_to_merge',
      'Error: HTTP 429 too many requests',
    );

    expect(stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'transition_to_ready_to_merge',
        autoRetry: {
          attempt: 1,
          retryQueueJobId: 'auto-retry-run-1-transition_to_ready_to_merge',
        },
      }),
      expect.objectContaining({ delay: 60000 }),
    );
    expect(stateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      '_internal.auto_retry.transition_to_ready_to_merge.last_failure',
      expect.objectContaining({
        reasonCode: 'provider_rate_limit_429',
        attempt: 1,
        retryQueueJobId: 'auto-retry-run-1-transition_to_ready_to_merge',
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_RETRY_SCHEDULED_EVENT,
      expect.objectContaining({
        payload: expect.objectContaining({
          reasonCode: 'provider_rate_limit_429',
        }),
      }),
    );
    expect(runRepo.update).not.toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(result).toBe('retry_scheduled');
  });

  it('schedules enabled provider overload auto-retry even when generic workflow auto-retry is disabled', async () => {
    const {
      call,
      runRepo,
      loadWorkflowDefinition,
      stateManager,
      stepQueue,
      eventEmitter,
      systemSettings,
    } = createHandler({ autoRetryEnabled: false });

    systemSettings.get.mockImplementation(
      async (key: string, defaultValue: unknown) => {
        const overrides: Record<string, unknown> = {
          workflow_auto_retry_enabled: false,
          workflow_auto_retry_max_attempts: 3,
          workflow_auto_retry_initial_delay_ms: 60000,
          workflow_auto_retry_max_delay_ms: 300000,
          workflow_auto_retry_backoff_multiplier: 2,
          workflow_auto_retry_jitter_ratio: 0,
          workflow_auto_retry_max_in_flight: 5,
          workflow_auto_retry_provider_overload_enabled: true,
          workflow_auto_retry_provider_overload_delay_ms: 18000000,
        };

        return key in overrides ? overrides[key] : defaultValue;
      },
    );
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'transition_to_ready_to_merge' }],
    });
    stateManager.getVariable.mockResolvedValue(0);

    await call(
      'run-1',
      'transition_to_ready_to_merge',
      'Tool invoke_agent_workflow API call failed (HTTP 529): High traffic detected',
    );

    expect(stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'transition_to_ready_to_merge',
        autoRetry: {
          attempt: 1,
          retryQueueJobId: 'auto-retry-run-1-transition_to_ready_to_merge',
        },
      }),
      expect.objectContaining({ delay: 18000000 }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_RETRY_SCHEDULED_EVENT,
      expect.objectContaining({
        payload: expect.objectContaining({
          reasonCode: 'provider_overload_529',
          delayMs: 18000000,
        }),
      }),
    );
    expect(runRepo.update).not.toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('keeps generic workflow failures gated when generic workflow auto-retry is disabled', async () => {
    const { call, runRepo, stepQueue } = createHandler({
      autoRetryEnabled: false,
    });

    const result = await call(
      'run-1',
      'transition_to_ready_to_merge',
      'generic boom',
    );

    expect(stepQueue.add).not.toHaveBeenCalled();
    expect(runRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(result).toBe('failed');
  });

  it('keeps provider-only retries gated by in-flight capacity', async () => {
    const {
      call,
      runRepo,
      loadWorkflowDefinition,
      stateManager,
      stepQueue,
      eventEmitter,
      systemSettings,
    } = createHandler({ autoRetryEnabled: false });

    systemSettings.get.mockImplementation(
      async (key: string, defaultValue: unknown) => {
        const overrides: Record<string, unknown> = {
          workflow_auto_retry_enabled: false,
          workflow_auto_retry_max_attempts: 3,
          workflow_auto_retry_initial_delay_ms: 60000,
          workflow_auto_retry_max_delay_ms: 300000,
          workflow_auto_retry_backoff_multiplier: 2,
          workflow_auto_retry_jitter_ratio: 0,
          workflow_auto_retry_max_in_flight: 2,
        };

        return key in overrides ? overrides[key] : defaultValue;
      },
    );
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'transition_to_ready_to_merge' }],
    });
    stateManager.getVariable.mockResolvedValue(0);
    stepQueue.getJobs.mockResolvedValue([
      { id: 'auto-retry-run-a-job-a' },
      { id: 'auto-retry-run-b-job-b' },
      { id: 'execute-job-non-retry' },
    ]);

    await call(
      'run-1',
      'transition_to_ready_to_merge',
      'Error: HTTP 429 too many requests',
    );

    expect(stepQueue.add).not.toHaveBeenCalled();
    expect(runRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_FAILED_EVENT,
      expect.objectContaining({
        workflowRunId: 'run-1',
        status: 'FAILED',
      }),
    );
  });

  it('schedules auto retry instead of failing when enabled and attempts remain', async () => {
    const {
      call,
      runRepo,
      loadWorkflowDefinition,
      stateManager,
      stepQueue,
      eventEmitter,
      systemSettings,
    } = createHandler({ autoRetryEnabled: true });

    systemSettings.get.mockImplementation(
      async (key: string, defaultValue: unknown) => {
        const overrides: Record<string, unknown> = {
          workflow_auto_retry_enabled: true,
          workflow_auto_retry_max_attempts: 3,
          workflow_auto_retry_initial_delay_ms: 60000,
          workflow_auto_retry_max_delay_ms: 5000,
          workflow_auto_retry_backoff_multiplier: 2,
          workflow_auto_retry_jitter_ratio: 0,
          workflow_auto_retry_max_in_flight: 5,
        };

        return key in overrides ? overrides[key] : defaultValue;
      },
    );
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'transition_to_ready_to_merge' }],
    });
    stateManager.getVariable.mockResolvedValue(1);

    const result = await call('run-1', 'transition_to_ready_to_merge', 'boom');

    expect(stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'transition_to_ready_to_merge',
      }),
      expect.objectContaining({
        delay: 60000,
      }),
    );
    expect(runRepo.update).not.toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_RETRY_SCHEDULED_EVENT,
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'transition_to_ready_to_merge',
      }),
    );
    expect(result).toBe('retry_scheduled');
  });

  it('does not terminally fail while a delayed auto-retry is already pending', async () => {
    const { call, runRepo, stateManager, eventEmitter, terminalRunCloser } =
      createHandler({ autoRetryEnabled: false });
    const jobId = 'transition_to_ready_to_merge';
    const pendingRetryAt = new Date(Date.now() + 60_000).toISOString();

    stateManager.getVariable.mockImplementation(async (_runId, path) => {
      if (path === autoRetryLastFailurePath(jobId)) {
        return {
          nextRetryAt: pendingRetryAt,
          retryQueueJobId: 'auto-retry-run-1-transition_to_ready_to_merge',
          attempt: 1,
        };
      }
      return null;
    });

    const result = await call('run-1', jobId, 'Provider finish_reason: abort');

    expect(result).toBe('retry_scheduled');
    expect(runRepo.update).not.toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: WorkflowStatus.FAILED }),
    );
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      WORKFLOW_RUN_FAILED_EVENT,
      expect.anything(),
    );
    expect(terminalRunCloser.closeFailedRun).not.toHaveBeenCalled();
    expect(stateManager.deleteVariable).not.toHaveBeenCalledWith(
      'run-1',
      '_internal.auto_retry.transition_to_ready_to_merge',
    );
  });

  it('does not enqueue a second auto-retry while a delayed auto-retry is already pending', async () => {
    const { call, loadWorkflowDefinition, stateManager, stepQueue } =
      createHandler({ autoRetryEnabled: true });
    const jobId = 'transition_to_ready_to_merge';
    const pendingRetryAt = new Date(Date.now() + 60_000).toISOString();

    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: jobId }],
    });
    stateManager.getVariable.mockImplementation(async (_runId, path) => {
      if (path === autoRetryLastFailurePath(jobId)) {
        return {
          nextRetryAt: pendingRetryAt,
          retryQueueJobId: 'auto-retry-run-1-transition_to_ready_to_merge',
          attempt: 1,
        };
      }
      if (path.includes('.attempt')) {
        return 1;
      }
      return null;
    });

    const result = await call('run-1', jobId, 'Provider finish_reason: abort');

    expect(result).toBe('retry_scheduled');
    expect(stepQueue.add).not.toHaveBeenCalled();
  });

  it('does not enqueue a second auto-retry when the pending retry marker is due but not activated', async () => {
    const { call, loadWorkflowDefinition, stateManager, stepQueue } =
      createHandler({ autoRetryEnabled: true });
    const jobId = 'transition_to_ready_to_merge';
    const dueRetryAt = new Date(Date.now() - 60_000).toISOString();

    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: jobId }],
    });
    stateManager.getVariable.mockImplementation(async (_runId, path) => {
      if (path === autoRetryLastFailurePath(jobId)) {
        return {
          nextRetryAt: dueRetryAt,
          retryQueueJobId: 'auto-retry-run-1-transition_to_ready_to_merge',
          attempt: 1,
        };
      }
      if (path.includes('.attempt')) {
        return 1;
      }
      return null;
    });

    const result = await call('run-1', jobId, 'Provider finish_reason: abort');

    expect(result).toBe('retry_scheduled');
    expect(stepQueue.add).not.toHaveBeenCalled();
  });

  it('uses configurable provider overload retry delay for HTTP 529 failures', async () => {
    const {
      call,
      loadWorkflowDefinition,
      stateManager,
      stepQueue,
      eventEmitter,
      systemSettings,
    } = createHandler({ autoRetryEnabled: true });

    systemSettings.get.mockImplementation(
      async (key: string, defaultValue: unknown) => {
        const overrides: Record<string, unknown> = {
          workflow_auto_retry_enabled: true,
          workflow_auto_retry_max_attempts: 3,
          workflow_auto_retry_initial_delay_ms: 60000,
          workflow_auto_retry_max_delay_ms: 300000,
          workflow_auto_retry_backoff_multiplier: 2,
          workflow_auto_retry_jitter_ratio: 0,
          workflow_auto_retry_max_in_flight: 5,
          workflow_auto_retry_provider_overload_enabled: true,
          workflow_auto_retry_provider_overload_delay_ms: 18000000,
        };

        return key in overrides ? overrides[key] : defaultValue;
      },
    );
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'transition_to_ready_to_merge' }],
    });
    stateManager.getVariable.mockResolvedValue(0);

    await call(
      'run-1',
      'transition_to_ready_to_merge',
      'Tool invoke_agent_workflow API call failed (HTTP 529): High traffic detected',
    );

    expect(stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'transition_to_ready_to_merge',
      }),
      expect.objectContaining({
        delay: 18000000,
      }),
    );

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_RETRY_SCHEDULED_EVENT,
      expect.objectContaining({
        payload: expect.objectContaining({
          reasonCode: 'provider_overload_529',
          delayMs: 18000000,
        }),
      }),
    );
  });

  it('retries provider rate limit even when max attempts are reached if within duration cap', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-05-01T10:00:00Z');
    vi.setSystemTime(now);

    const {
      call,
      loadWorkflowDefinition,
      stateManager,
      stepQueue,
      eventEmitter,
      systemSettings,
    } = createHandler({ autoRetryEnabled: true });

    systemSettings.get.mockImplementation(
      async (key: string, defaultValue: unknown) => {
        const overrides: Record<string, unknown> = {
          workflow_auto_retry_enabled: true,
          workflow_auto_retry_max_attempts: 3,
          workflow_auto_retry_max_duration_ms: 3600000,
        };

        return key in overrides ? overrides[key] : defaultValue;
      },
    );
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'transition_to_ready_to_merge' }],
    });

    const firstFailureAt = new Date(now.getTime() - 1000).toISOString();
    stateManager.getVariable.mockImplementation(async (_runId, path) => {
      if (path.includes('.attempt')) return 3; // Max attempts reached
      if (path.includes('.first_failure_at')) return firstFailureAt;
      return 0;
    });

    await call(
      'run-1',
      'transition_to_ready_to_merge',
      'Error: HTTP 429 too many requests',
    );

    expect(stepQueue.add).toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_RETRY_SCHEDULED_EVENT,
      expect.objectContaining({
        payload: expect.objectContaining({
          reasonCode: 'provider_rate_limit_429',
          attempt: 4,
        }),
      }),
    );
  });

  it('schedules provider rate limit auto-retries with reset metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T14:00:00Z'));

    try {
      const {
        call,
        runRepo,
        loadWorkflowDefinition,
        stateManager,
        stepQueue,
        eventEmitter,
        systemSettings,
      } = createHandler({ autoRetryEnabled: true });

      systemSettings.get.mockImplementation(
        async (key: string, defaultValue: unknown) => {
          const overrides: Record<string, unknown> = {
            workflow_auto_retry_enabled: true,
            workflow_auto_retry_max_attempts: 3,
            workflow_auto_retry_initial_delay_ms: 60000,
            workflow_auto_retry_max_delay_ms: 300000,
            workflow_auto_retry_backoff_multiplier: 2,
            workflow_auto_retry_jitter_ratio: 0,
            workflow_auto_retry_max_in_flight: 5,
            workflow_auto_retry_provider_overload_enabled: true,
            workflow_auto_retry_provider_overload_delay_ms: 18000000,
            workflow_auto_retry_rate_limit_reset_buffer_ms: 60000,
          };

          return key in overrides ? overrides[key] : defaultValue;
        },
      );
      loadWorkflowDefinition.mockResolvedValue({
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [{ id: 'transition_to_ready_to_merge' }],
      });
      stateManager.getVariable.mockResolvedValue(0);

      await call(
        'run-1',
        'transition_to_ready_to_merge',
        '429 usage limit exceeded, 5-hour usage limit reached for Token Plan Starter (1500/1500 used), resets at 2026-04-29T15:00:00Z',
      );

      expect(stepQueue.add).toHaveBeenCalledWith(
        'execute-job',
        expect.objectContaining({
          workflowRunId: 'run-1',
          jobId: 'transition_to_ready_to_merge',
        }),
        expect.objectContaining({
          delay: 3660000,
        }),
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WORKFLOW_RUN_RETRY_SCHEDULED_EVENT,
        expect.objectContaining({
          payload: expect.objectContaining({
            reasonCode: 'provider_rate_limit_429',
            delayMs: 3660000,
            resetAt: '2026-04-29T15:00:00.000Z',
            nextRetryAt: '2026-04-29T15:01:00.000Z',
            providerTier: 'Token Plan Starter',
            usageLimit: { used: 1500, limit: 1500, unit: 'tokens' },
          }),
        }),
      );
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        WORKFLOW_RUN_FAILED_EVENT,
        expect.anything(),
      );
      expect(stateManager.setVariable).toHaveBeenCalledWith(
        'run-1',
        '_internal.auto_retry.transition_to_ready_to_merge.last_failure',
        expect.objectContaining({
          reasonCode: 'provider_rate_limit_429',
          reason:
            '429 usage limit exceeded, 5-hour usage limit reached for Token Plan Starter (1500/1500 used), resets at 2026-04-29T15:00:00Z',
          resetAt: '2026-04-29T15:00:00.000Z',
          nextRetryAt: '2026-04-29T15:01:00.000Z',
          providerTier: 'Token Plan Starter',
          usageLimit: { used: 1500, limit: 1500, unit: 'tokens' },
        }),
      );
      expect(runRepo.update).not.toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'FAILED' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to default retry delay when provider overload override is disabled', async () => {
    const {
      call,
      loadWorkflowDefinition,
      stateManager,
      stepQueue,
      systemSettings,
    } = createHandler({ autoRetryEnabled: true });

    systemSettings.get.mockImplementation(
      async (key: string, defaultValue: unknown) => {
        const overrides: Record<string, unknown> = {
          workflow_auto_retry_enabled: true,
          workflow_auto_retry_max_attempts: 3,
          workflow_auto_retry_initial_delay_ms: 60000,
          workflow_auto_retry_max_delay_ms: 300000,
          workflow_auto_retry_backoff_multiplier: 2,
          workflow_auto_retry_jitter_ratio: 0,
          workflow_auto_retry_max_in_flight: 5,
          workflow_auto_retry_provider_overload_enabled: false,
          workflow_auto_retry_provider_overload_delay_ms: 18000000,
        };

        return key in overrides ? overrides[key] : defaultValue;
      },
    );
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'transition_to_ready_to_merge' }],
    });
    stateManager.getVariable.mockResolvedValue(0);

    await call(
      'run-1',
      'transition_to_ready_to_merge',
      'Tool invoke_agent_workflow API call failed (HTTP 529): High traffic detected',
    );

    expect(stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'transition_to_ready_to_merge',
      }),
      expect.objectContaining({
        delay: 60000,
      }),
    );
  });

  it('does not auto-retry deterministic refinement readiness failures', async () => {
    const {
      call,
      runRepo,
      loadWorkflowDefinition,
      stateManager,
      stepQueue,
      eventEmitter,
      systemSettings,
    } = createHandler({ autoRetryEnabled: true });

    systemSettings.get.mockImplementation(
      async (key: string, defaultValue: unknown) => {
        const overrides: Record<string, unknown> = {
          workflow_auto_retry_enabled: true,
          workflow_auto_retry_max_attempts: 10,
          workflow_auto_retry_initial_delay_ms: 60000,
          workflow_auto_retry_max_delay_ms: 3000000000,
          workflow_auto_retry_backoff_multiplier: 10,
          workflow_auto_retry_jitter_ratio: 0.2,
          workflow_auto_retry_max_in_flight: 5,
        };

        return key in overrides ? overrides[key] : defaultValue;
      },
    );
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'validate_refinement_exit_readiness' }],
    });
    stateManager.getVariable.mockResolvedValue(0);

    await call(
      'run-1',
      'validate_refinement_exit_readiness',
      'Step validate_refinement_exit_readiness: refinement exit readiness failed for work item work-1: missing_subtasks',
    );

    expect(stepQueue.add).not.toHaveBeenCalled();
    expect(runRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_FAILED_EVENT,
      expect.objectContaining({
        workflowRunId: 'run-1',
        status: 'FAILED',
        failedJobId: 'validate_refinement_exit_readiness',
        errorMessage:
          'job_failed_after_retries: Step validate_refinement_exit_readiness: refinement exit readiness failed for work item work-1: missing_subtasks',
      }),
    );
  });

  it('does not auto-retry exhausted output contract failures', async () => {
    const {
      call,
      runRepo,
      loadWorkflowDefinition,
      stateManager,
      stepQueue,
      eventEmitter,
      systemSettings,
    } = createHandler({ autoRetryEnabled: true });

    systemSettings.get.mockImplementation(
      async (key: string, defaultValue: unknown) => {
        const overrides: Record<string, unknown> = {
          workflow_auto_retry_enabled: true,
          workflow_auto_retry_max_attempts: 10,
          workflow_auto_retry_initial_delay_ms: 60000,
          workflow_auto_retry_max_delay_ms: 300000,
          workflow_auto_retry_backoff_multiplier: 2,
          workflow_auto_retry_jitter_ratio: 0,
          workflow_auto_retry_max_in_flight: 5,
        };

        return key in overrides ? overrides[key] : defaultValue;
      },
    );
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'refine_strategy_and_specs' }],
    });
    stateManager.getVariable.mockResolvedValue(0);

    await call(
      'run-1',
      'refine_strategy_and_specs',
      'Job refine_strategy_and_specs run 5aa76524-9f72-489e-90e6-166388398ba8: output_contract fields [decision, actions_taken] not provided. Max retries (0) exhausted — failing job.',
    );

    expect(stepQueue.add).not.toHaveBeenCalled();
    expect(runRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_FAILED_EVENT,
      expect.objectContaining({
        workflowRunId: 'run-1',
        status: 'FAILED',
      }),
    );
  });

  it('suppresses auto-retry when too many auto-retries are already in flight', async () => {
    const {
      call,
      runRepo,
      loadWorkflowDefinition,
      stateManager,
      stepQueue,
      eventEmitter,
      systemSettings,
    } = createHandler({ autoRetryEnabled: true });

    systemSettings.get.mockImplementation(
      async (key: string, defaultValue: unknown) => {
        const overrides: Record<string, unknown> = {
          workflow_auto_retry_enabled: true,
          workflow_auto_retry_max_attempts: 3,
          workflow_auto_retry_initial_delay_ms: 60000,
          workflow_auto_retry_max_delay_ms: 300000,
          workflow_auto_retry_backoff_multiplier: 2,
          workflow_auto_retry_jitter_ratio: 0,
          workflow_auto_retry_max_in_flight: 2,
        };

        return key in overrides ? overrides[key] : defaultValue;
      },
    );
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'transition_to_ready_to_merge' }],
    });
    stateManager.getVariable.mockResolvedValue(0);
    stepQueue.getJobs.mockResolvedValue([
      { id: 'auto-retry-run-a-job-a' },
      { id: 'auto-retry-run-b-job-b' },
      { id: 'execute-job-non-retry' },
    ]);

    await call('run-1', 'transition_to_ready_to_merge', 'boom');

    expect(stepQueue.add).not.toHaveBeenCalled();
    expect(runRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_FAILED_EVENT,
      expect.objectContaining({
        workflowRunId: 'run-1',
        status: 'FAILED',
      }),
    );
  });

  it('passes a resume ref when retrying a timed-out agent step with no persisted output', async () => {
    const {
      call,
      loadWorkflowDefinition,
      stateManager,
      sessionHydration,
      stepQueue,
      systemSettings,
    } = createHandler({ autoRetryEnabled: true });

    // No persisted output → salvage branch skips
    stateManager.getVariable.mockResolvedValue(null);
    // Session tree exists → resume ref is plumbed into the retry
    sessionHydration.findSessionTreeByWorkflowRunId.mockResolvedValue({
      id: 'tree-9',
    });
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'implement_and_commit' }],
    });
    systemSettings.get.mockImplementation(
      async (key: string, defaultValue: unknown) => {
        if (key === 'workflow_auto_retry_enabled') return true;
        if (key === 'workflow_auto_retry_max_attempts') return 3;
        return defaultValue;
      },
    );

    const result = await call(
      'run-1',
      'implement_and_commit',
      'HTTP POST timed out: http://172.18.0.10:8374/execute/agent',
    );

    expect(result).toBe('retry_scheduled');
    expect(stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({
        autoRetry: expect.objectContaining({
          resume: { resumeSessionTreeId: 'tree-9' },
        }),
      }),
      expect.any(Object),
    );
  });

  it('passes a resume ref when retrying a provider-aborted agent step', async () => {
    const {
      call,
      loadWorkflowDefinition,
      sessionHydration,
      stateManager,
      stepQueue,
      systemSettings,
    } = createHandler({ autoRetryEnabled: true });

    stateManager.getVariable.mockResolvedValue(0);
    sessionHydration.findSessionTreeByWorkflowRunId.mockResolvedValue({
      id: 'tree-provider-abort',
    });
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'war_room_plan_alignment' }],
    });
    systemSettings.get.mockImplementation(
      async (key: string, defaultValue: unknown) => {
        if (key === 'workflow_auto_retry_enabled') return true;
        if (key === 'workflow_auto_retry_max_attempts') return 3;
        return defaultValue;
      },
    );

    const result = await call(
      'run-1',
      'war_room_plan_alignment',
      'Provider finish_reason: abort',
    );

    expect(result).toBe('retry_scheduled');
    expect(stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({
        autoRetry: expect.objectContaining({
          resume: { resumeSessionTreeId: 'tree-provider-abort' },
        }),
      }),
      expect.any(Object),
    );
  });

  it('salvages a transport-timeout failure when job output already exists', async () => {
    const { call, completeJob, stateManager } = createHandler({
      autoRetryEnabled: true,
    });

    stateManager.getVariable.mockImplementation(
      async (_run: string, path: string) =>
        path === 'jobs.implement_and_commit.output'
          ? { summary: 'done' }
          : null,
    );

    const result = await call(
      'run-1',
      'implement_and_commit',
      'HTTP POST timed out: http://172.18.0.10:8374/execute/agent',
    );

    expect(completeJob).toHaveBeenCalledWith('run-1', 'implement_and_commit', {
      summary: 'done',
    });
    expect(result).toBe('salvaged');
  });

  it('salvages a 504 gateway timeout failure when job output already exists', async () => {
    const { call, completeJob, stateManager } = createHandler({
      autoRetryEnabled: true,
    });

    stateManager.getVariable.mockImplementation(
      async (_run: string, path: string) =>
        path === 'jobs.implement_and_commit.output'
          ? { summary: 'done' }
          : null,
    );

    const result = await call(
      'run-1',
      'implement_and_commit',
      '504 The request timed out while processing. Please try again later. (2066)',
    );

    expect(completeJob).toHaveBeenCalledWith('run-1', 'implement_and_commit', {
      summary: 'done',
    });
    expect(result).toBe('salvaged');
  });

  it('does not salvage a transport-timeout failure when no output was persisted', async () => {
    const { call, completeJob, runRepo, loadWorkflowDefinition, stateManager } =
      createHandler({
        autoRetryEnabled: true,
      });

    // The transport-timeout retry path also needs a workflow def for retry
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'implement_and_commit' }],
    });
    stateManager.getVariable.mockResolvedValue(null);

    const result = await call(
      'run-1',
      'implement_and_commit',
      'HTTP POST timed out: http://172.18.0.10:8374/execute/agent',
    );

    expect(completeJob).not.toHaveBeenCalled();
    // Falls through to the retry path; with auto-retry enabled a transport
    // timeout schedules a retry rather than failing the run outright.
    expect(runRepo.update).not.toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(result).toBe('retry_scheduled');
  });

  it('passes resumeOverride to scheduleWorkflowAutoRetry when not transport timeout', async () => {
    const {
      call,
      loadWorkflowDefinition,
      stateManager,
      stepQueue,
      systemSettings,
    } = createHandler({ autoRetryEnabled: true });

    systemSettings.get.mockImplementation(
      async (key: string, defaultValue: unknown) => {
        const overrides: Record<string, unknown> = {
          workflow_auto_retry_enabled: true,
          workflow_auto_retry_max_attempts: 3,
          workflow_auto_retry_initial_delay_ms: 60000,
          workflow_auto_retry_max_delay_ms: 300000,
          workflow_auto_retry_backoff_multiplier: 2,
          workflow_auto_retry_jitter_ratio: 0,
          workflow_auto_retry_max_in_flight: 5,
        };
        return key in overrides ? overrides[key] : defaultValue;
      },
    );
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'j1' }],
    });
    stateManager.getVariable.mockResolvedValue(0);

    await call('run-1', 'j1', 'stale-run watchdog', {
      resumeSessionTreeId: 'tree-1',
      resumeSessionRef: { kind: 'pi', treeId: 'tree-1', resumeNodeId: 'n1' },
    });

    expect(stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'j1',
        autoRetry: expect.objectContaining({
          resume: {
            resumeSessionTreeId: 'tree-1',
            resumeSessionRef: {
              kind: 'pi',
              treeId: 'tree-1',
              resumeNodeId: 'n1',
            },
          },
        }),
      }),
      expect.any(Object),
    );
  });

  describe('question-park delegation (Fixes A/B)', () => {
    const runningRun = (over: Record<string, unknown> = {}) => ({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.RUNNING,
      awaiting_input: false,
      wait_reason: null,
      state_variables: {},
      ...over,
    });

    it('Fix A: returns "ignored" (no retry) when questionPark flags idle-question teardown', async () => {
      const ctx = createHandler({ autoRetryEnabled: true });
      ctx.runRepo.findById.mockResolvedValue(
        runningRun({ awaiting_input: true }),
      );
      ctx.questionPark.isIdleQuestionTeardownTimeout.mockResolvedValue(true);

      const result = await ctx.call('run-1', 'job-1', 'socket hang up');

      expect(result).toBe('ignored');
      expect(ctx.stepQueue.add).not.toHaveBeenCalled();
    });

    it('Fix A: still retries a transport timeout when questionPark does not flag teardown', async () => {
      const ctx = createHandler({ autoRetryEnabled: true });
      ctx.loadWorkflowDefinition.mockResolvedValue({
        workflow_id: 'wf',
        name: 'WF',
        jobs: [{ id: 'job-1' }],
      });
      ctx.runRepo.findById.mockResolvedValue(
        runningRun({ awaiting_input: true }),
      );
      ctx.questionPark.isIdleQuestionTeardownTimeout.mockResolvedValue(false);

      const result = await ctx.call('run-1', 'job-1', 'socket hang up');

      expect(result).not.toBe('ignored');
    });

    it('Fix B: clears orphaned question state when a retry is scheduled', async () => {
      const ctx = createHandler({ autoRetryEnabled: true });
      ctx.loadWorkflowDefinition.mockResolvedValue({
        workflow_id: 'wf',
        name: 'WF',
        jobs: [{ id: 'job-1' }],
      });
      const run = runningRun({ awaiting_input: true });
      ctx.runRepo.findById.mockResolvedValue(run);
      ctx.questionPark.isIdleQuestionTeardownTimeout.mockResolvedValue(false);

      const result = await ctx.call('run-1', 'job-1', 'provider overloaded');

      expect(result).toBe('retry_scheduled');
      expect(
        ctx.questionPark.clearOrphanedQuestionStateOnRetry,
      ).toHaveBeenCalledWith(run);
    });
  });
});
