import { describe, expect, it, vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import {
  WorkflowRunReconciliationService,
  resolveStaleRunGraceMs,
  DEFAULT_STALE_RUN_GRACE_MS,
} from './workflow-run-reconciliation.service';
import { ServiceLifecycleStateService } from '../../execution-lifecycle/service-lifecycle-state.service';
import { ShutdownStateService } from '../../shutdown/shutdown-state.service';

describe('resolveStaleRunGraceMs', () => {
  it('defaults to 5 minutes', () => {
    expect(resolveStaleRunGraceMs(undefined)).toBe(DEFAULT_STALE_RUN_GRACE_MS);
    expect(DEFAULT_STALE_RUN_GRACE_MS).toBe(5 * 60 * 1000);
  });

  it('reads a positive integer from env', () => {
    expect(resolveStaleRunGraceMs('600000')).toBe(600_000);
  });

  it('falls back to default on invalid input', () => {
    expect(resolveStaleRunGraceMs('nope')).toBe(DEFAULT_STALE_RUN_GRACE_MS);
    expect(resolveStaleRunGraceMs('0')).toBe(DEFAULT_STALE_RUN_GRACE_MS);
  });
});

describe('WorkflowRunReconciliationService', () => {
  type FakeJob = { id?: string; data: unknown; failedReason?: string };

  const createRunningLifecycle = (): ServiceLifecycleStateService => {
    const lifecycle = new ServiceLifecycleStateService();
    lifecycle.markRunning();
    return lifecycle;
  };

  const createService = (
    lifecycle: ServiceLifecycleStateService = createRunningLifecycle(),
    shutdownState?: ShutdownStateService,
  ) => {
    const runRepo = {
      findByStatus: vi.fn().mockResolvedValue([]),
      findOldestRunningByScope: vi.fn().mockResolvedValue(null),
    };

    const runExecution = {
      handleJobFailed: vi.fn().mockResolvedValue('failed'),
      handleJobComplete: vi.fn().mockResolvedValue(undefined),
      activateQueuedRun: vi.fn().mockResolvedValue({ activated: true }),
      cancelUnactivatablePendingRun: vi.fn().mockResolvedValue(undefined),
    };

    const questionAwaitRepo = {
      findRunIdsWithOpenQuestions: vi.fn().mockResolvedValue(new Set<string>()),
    };

    const stepQueue = {
      getJobs: vi.fn(),
    };

    const executionRepo = {
      findNonTerminal: vi.fn().mockResolvedValue([]),
    };

    const interruptionRecovery = {
      prepareRecovery: vi.fn().mockResolvedValue({
        cancelledSubagentExecutions: [],
        parentResume: undefined,
      }),
    };

    // Default: report stale-heartbeat step containers as lost, so existing
    // stale-run recovery cases keep reaping. Tests immunising a healthy
    // long-running step override this to report the container alive.
    const containerLiveness = {
      isContainerLost: vi.fn().mockResolvedValue(true),
    };

    // Deterministic, order-independent queue mock: answers by requested state.
    const setQueueJobs = (jobs: { live?: FakeJob[]; failed?: FakeJob[] }) => {
      stepQueue.getJobs.mockImplementation((states: string[]) =>
        Promise.resolve(
          states.includes('failed') ? (jobs.failed ?? []) : (jobs.live ?? []),
        ),
      );
    };
    setQueueJobs({});

    const resolvedShutdownState =
      shutdownState ??
      (() => {
        const svc = new ShutdownStateService();
        vi.spyOn(svc, 'isShuttingDown').mockReturnValue(false);
        return svc;
      })();

    const service = new WorkflowRunReconciliationService(
      runRepo as unknown as IWorkflowRunRepository,
      runExecution as never,
      executionRepo as never,
      questionAwaitRepo as never,
      interruptionRecovery as never,
      stepQueue,
      lifecycle,
      resolvedShutdownState,
      containerLiveness,
    );

    return {
      service,
      runRepo,
      runExecution,
      executionRepo,
      questionAwaitRepo,
      interruptionRecovery,
      containerLiveness,
      stepQueue,
      setQueueJobs,
    };
  };

  it('delegates failed queue jobs to handleJobFailed with original reason', async () => {
    const { service, runRepo, runExecution, setQueueJobs } = createService();

    const staleRun = {
      id: 'run-1',
      current_step_id: 'discovery_and_specs',
      updated_at: new Date('2026-04-05T00:00:00.000Z'),
    };

    runRepo.findByStatus
      .mockResolvedValueOnce([staleRun])
      .mockResolvedValueOnce([]);

    setQueueJobs({
      failed: [
        {
          data: { workflowRunId: 'run-1', jobId: 'discovery_and_specs' },
          failedReason: 'job stalled more than allowable limit',
        },
      ],
    });

    await service.reconcileNow('manual');

    expect(runRepo.findByStatus).toHaveBeenCalledWith(WorkflowStatus.RUNNING);
    expect(runExecution.handleJobFailed).toHaveBeenCalledWith(
      'run-1',
      'discovery_and_specs',
      'job stalled more than allowable limit',
    );
    expect(runExecution.handleJobFailed).toHaveBeenCalledTimes(1);
  });

  it('does not fail a run that is awaiting user input even when a failed queue job exists', async () => {
    const { service, runRepo, runExecution, setQueueJobs } = createService();

    const awaitingRun = {
      id: 'run-awaiting',
      current_step_id: 'capture_charter',
      updated_at: new Date(Date.now() - 120_000),
      awaiting_input: true,
    };

    runRepo.findByStatus
      .mockResolvedValueOnce([awaitingRun])
      .mockResolvedValueOnce([]);

    setQueueJobs({});

    await service.reconcileNow('manual');

    expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
  });

  it('activates orphaned pending queued runs when no running run exists for the scope', async () => {
    const { service, runRepo, runExecution, setQueueJobs } = createService();

    runRepo.findByStatus.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'run-pending-1',
        workflow_id: 'workflow-1',
        concurrency_scope: 'scope-1',
        status: WorkflowStatus.PENDING,
      },
    ]);
    runRepo.findOldestRunningByScope.mockResolvedValue(null);
    setQueueJobs({});

    await service.reconcileNow('manual');

    expect(runRepo.findOldestRunningByScope).toHaveBeenCalledWith(
      'workflow-1',
      'scope-1',
    );
    expect(runExecution.activateQueuedRun).toHaveBeenCalledWith(
      'workflow-1',
      'scope-1',
    );
  });

  describe('unactivatable pending run cancellation', () => {
    const STALE = new Date('2020-01-01T00:00:00.000Z'); // older than any grace

    it('cancels orphaned pending runs that can never activate (policy no longer queues)', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'run-pending-a',
          workflow_id: 'workflow-x',
          concurrency_scope: 'scope-x',
          status: WorkflowStatus.PENDING,
          updated_at: STALE,
        },
        {
          id: 'run-pending-b',
          workflow_id: 'workflow-x',
          concurrency_scope: 'scope-x',
          status: WorkflowStatus.PENDING,
          updated_at: STALE,
        },
      ]);
      runRepo.findOldestRunningByScope.mockResolvedValue(null);
      runExecution.activateQueuedRun.mockResolvedValue({
        activated: false,
        reason: 'concurrency_not_queue',
      });
      setQueueJobs({});

      await service.reconcileNow('manual');

      // Both pending runs in the dead scope are cancelled, not just the oldest.
      expect(runExecution.cancelUnactivatablePendingRun).toHaveBeenCalledWith(
        'run-pending-a',
        expect.stringContaining('concurrency_not_queue'),
      );
      expect(runExecution.cancelUnactivatablePendingRun).toHaveBeenCalledWith(
        'run-pending-b',
        expect.any(String),
      );
      expect(runExecution.cancelUnactivatablePendingRun).toHaveBeenCalledTimes(
        2,
      );
    });

    it('cancels orphaned pending runs whose workflow can no longer be resolved', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'run-orphan',
          workflow_id: 'deleted_workflow_slug',
          concurrency_scope: 'scope-gone',
          status: WorkflowStatus.PENDING,
          updated_at: STALE,
        },
      ]);
      runRepo.findOldestRunningByScope.mockResolvedValue(null);
      runExecution.activateQueuedRun.mockResolvedValue({
        activated: false,
        reason: 'workflow_unresolvable',
      });
      setQueueJobs({});

      await service.reconcileNow('manual');

      expect(runExecution.cancelUnactivatablePendingRun).toHaveBeenCalledWith(
        'run-orphan',
        expect.stringContaining('workflow_unresolvable'),
      );
    });

    it('does not cancel when activation succeeds', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'run-ok',
          workflow_id: 'workflow-y',
          concurrency_scope: 'scope-y',
          status: WorkflowStatus.PENDING,
          updated_at: STALE,
        },
      ]);
      runRepo.findOldestRunningByScope.mockResolvedValue(null);
      runExecution.activateQueuedRun.mockResolvedValue({
        activated: true,
        runId: 'run-ok',
      });
      setQueueJobs({});

      await service.reconcileNow('manual');

      expect(runExecution.cancelUnactivatablePendingRun).not.toHaveBeenCalled();
    });

    it('does not cancel a pending run that is still within the grace window', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'run-fresh',
          workflow_id: 'workflow-z',
          concurrency_scope: 'scope-z',
          status: WorkflowStatus.PENDING,
          updated_at: new Date(), // just created — could still be activated
        },
      ]);
      runRepo.findOldestRunningByScope.mockResolvedValue(null);
      runExecution.activateQueuedRun.mockResolvedValue({
        activated: false,
        reason: 'concurrency_not_queue',
      });
      setQueueJobs({});

      await service.reconcileNow('manual');

      expect(runExecution.cancelUnactivatablePendingRun).not.toHaveBeenCalled();
    });

    it('does not cancel on a non-terminal activation reason (no pending run)', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'run-transient',
          workflow_id: 'workflow-q',
          concurrency_scope: 'scope-q',
          status: WorkflowStatus.PENDING,
          updated_at: STALE,
        },
      ]);
      runRepo.findOldestRunningByScope.mockResolvedValue(null);
      runExecution.activateQueuedRun.mockResolvedValue({
        activated: false,
        reason: 'no_pending_run',
      });
      setQueueJobs({});

      await service.reconcileNow('manual');

      expect(runExecution.cancelUnactivatablePendingRun).not.toHaveBeenCalled();
    });

    it('does not cancel when a running owner still holds the scope', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'run-waiting',
          workflow_id: 'workflow-w',
          concurrency_scope: 'scope-w',
          status: WorkflowStatus.PENDING,
          updated_at: STALE,
        },
      ]);
      runRepo.findOldestRunningByScope.mockResolvedValue({ id: 'owner-run' });
      setQueueJobs({});

      await service.reconcileNow('manual');

      expect(runExecution.activateQueuedRun).not.toHaveBeenCalled();
      expect(runExecution.cancelUnactivatablePendingRun).not.toHaveBeenCalled();
    });
  });

  it('deduplicates the same failed queue job across multiple reconciliation runs', async () => {
    const { service, runRepo, runExecution, setQueueJobs } = createService();

    const runningRun = {
      id: 'run-1',
      current_step_id: 'discovery_and_specs',
      updated_at: new Date('2026-04-05T00:00:00.000Z'),
    };

    runRepo.findByStatus
      .mockResolvedValueOnce([runningRun])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([runningRun])
      .mockResolvedValueOnce([]);

    const failedJob = {
      id: 'queue-job-1',
      data: {
        workflowRunId: 'run-1',
        jobId: 'discovery_and_specs',
      },
      failedReason: 'job stalled more than allowable limit',
    };

    setQueueJobs({ failed: [failedJob] });

    await service.reconcileNow('manual');
    await service.reconcileNow('manual');

    expect(runExecution.handleJobFailed).toHaveBeenCalledTimes(1);
    expect(runExecution.handleJobFailed).toHaveBeenCalledWith(
      'run-1',
      'discovery_and_specs',
      'job stalled more than allowable limit',
    );
  });

  it('delegates to handleJobFailed with original failedReason and does not replay events', async () => {
    const { service, runRepo, runExecution, setQueueJobs } = createService();

    const runningRun = {
      id: 'run-dedupe',
      current_step_id: 'build_and_test',
      updated_at: new Date('2026-04-05T00:00:00.000Z'),
    };

    runRepo.findByStatus
      .mockResolvedValueOnce([runningRun])
      .mockResolvedValueOnce([]);

    setQueueJobs({
      failed: [
        {
          id: 'queue-job-dedupe',
          data: { workflowRunId: 'run-dedupe', jobId: 'build_and_test' },
          failedReason: 'Git command failed: author identity unknown',
        },
      ],
    });

    await service.reconcileNow('manual');

    expect(runExecution.handleJobFailed).toHaveBeenCalledWith(
      'run-dedupe',
      'build_and_test',
      'Git command failed: author identity unknown',
    );
    expect(runExecution.handleJobFailed).toHaveBeenCalledTimes(1);
  });

  it('retries a failed queue job if handleJobFailed threw on the first attempt', async () => {
    const { service, runRepo, runExecution, setQueueJobs } = createService();

    const runningRun = {
      id: 'run-5',
      current_step_id: 'build_and_test',
      updated_at: new Date('2026-04-05T00:00:00.000Z'),
    };

    runRepo.findByStatus
      .mockResolvedValueOnce([runningRun])
      .mockResolvedValueOnce([runningRun])
      .mockResolvedValueOnce([]);

    const failedJob = {
      id: 'queue-job-5',
      data: {
        workflowRunId: 'run-5',
        jobId: 'build_and_test',
      },
      failedReason: 'container oom-killed',
    };

    setQueueJobs({ failed: [failedJob] });

    runExecution.handleJobFailed
      .mockRejectedValueOnce(new Error('transient db error'))
      .mockResolvedValueOnce('failed');

    await service.reconcileNow('manual');
    await service.reconcileNow('manual');

    expect(runExecution.handleJobFailed).toHaveBeenCalledTimes(2);
    expect(runExecution.handleJobFailed).toHaveBeenNthCalledWith(
      1,
      'run-5',
      'build_and_test',
      'container oom-killed',
    );
    expect(runExecution.handleJobFailed).toHaveBeenNthCalledWith(
      2,
      'run-5',
      'build_and_test',
      'container oom-killed',
    );
  });

  it('does not re-handle a failed queue job when the run already has a live job', async () => {
    const { service, runRepo, runExecution, setQueueJobs } = createService();

    const runningRun = {
      id: 'run-live',
      current_step_id: 'ceo_orchestration_decision',
      updated_at: new Date(),
      awaiting_input: false,
    };

    runRepo.findByStatus
      .mockResolvedValueOnce([runningRun]) // RUNNING
      .mockResolvedValueOnce([]); // PENDING

    setQueueJobs({
      // The in-band onFailed handler already scheduled the delayed auto-retry,
      // so the run has a live job in the queue.
      live: [
        {
          data: {
            workflowRunId: 'run-live',
            jobId: 'ceo_orchestration_decision',
          },
        },
      ],
      failed: [
        {
          id: 'queue-job-live',
          data: {
            workflowRunId: 'run-live',
            jobId: 'ceo_orchestration_decision',
          },
          failedReason: 'column DomainEventOutboxEntity.eventId does not exist',
        },
      ],
    });

    await service.reconcileNow('manual');

    expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
  });

  describe('stale RUNNING run recovery', () => {
    const STALE = new Date('2020-01-01T00:00:00.000Z'); // far older than any grace
    const FRESH = new Date(); // within grace

    it('recovers a stale RUNNING run with no live job via handleJobFailed', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-stranded',
            current_step_id: 'ceo_orchestration_decision',
            updated_at: STALE,
            awaiting_input: false,
          },
        ]) // RUNNING
        .mockResolvedValueOnce([]); // PENDING
      setQueueJobs({});

      await service.reconcileNow('manual');

      expect(runExecution.handleJobFailed).toHaveBeenCalledTimes(1);
      expect(runExecution.handleJobFailed).toHaveBeenCalledWith(
        'run-stranded',
        'ceo_orchestration_decision',
        expect.stringContaining('stale-run watchdog'),
        undefined,
      );
    });

    it('calls InterruptionRecoveryService and threads parentResume into handleJobFailed', async () => {
      const {
        service,
        runRepo,
        runExecution,
        executionRepo,
        interruptionRecovery,
        setQueueJobs,
      } = createService();

      interruptionRecovery.prepareRecovery.mockResolvedValue({
        cancelledSubagentExecutions: [
          {
            executionId: 'exec-1',
            sessionTreeId: 'tree-sub',
            agentProfileName: 'senior_dev',
          },
        ],
        parentResume: {
          resumeSessionTreeId: 'tree-parent',
          resumeSessionRef: {
            kind: 'pi',
            treeId: 'tree-parent',
            resumeNodeId: 'n1',
          },
        },
      });

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-subagent',
            current_step_id: 'implement_and_commit',
            updated_at: STALE,
            awaiting_input: false,
          },
        ])
        .mockResolvedValueOnce([]);
      setQueueJobs({});
      executionRepo.findNonTerminal.mockResolvedValue([
        {
          id: 'exec-parent',
          kind: 'workflow_step',
          state: 'running',
          workflow_run_id: 'run-subagent',
          container_id: 'container-parent-1',
          created_at: STALE,
          updated_at: STALE,
          last_heartbeat_at: null,
        },
      ]);

      await service.reconcileNow('manual');

      expect(interruptionRecovery.prepareRecovery).toHaveBeenCalledWith({
        workflowRunId: 'run-subagent',
        jobId: 'implement_and_commit',
        parentContainerIds: new Set(['container-parent-1']),
        source: 'stale-run-watchdog',
        parentExecutionId: 'exec-parent',
      });
      expect(runExecution.handleJobFailed).toHaveBeenCalledWith(
        'run-subagent',
        'implement_and_commit',
        expect.any(String),
        {
          resumeSessionTreeId: 'tree-parent',
          resumeSessionRef: {
            kind: 'pi',
            treeId: 'tree-parent',
            resumeNodeId: 'n1',
          },
        },
      );
    });

    it('does not touch a stale RUNNING run that still has a live job', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-live',
            current_step_id: 'ceo_orchestration_decision',
            updated_at: STALE,
            awaiting_input: false,
          },
        ])
        .mockResolvedValueOnce([]);
      setQueueJobs({
        live: [
          {
            data: {
              workflowRunId: 'run-live',
              jobId: 'ceo_orchestration_decision',
            },
          },
        ],
      });

      await service.reconcileNow('manual');

      expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
    });

    it('does not touch a RUNNING run updated within the grace window', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-fresh',
            current_step_id: 'ceo_orchestration_decision',
            updated_at: FRESH,
            awaiting_input: false,
          },
        ])
        .mockResolvedValueOnce([]);
      setQueueJobs({});

      await service.reconcileNow('manual');

      expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
    });

    it('does not touch a stale RUNNING run that is awaiting user input', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-awaiting',
            current_step_id: 'capture_charter',
            updated_at: STALE,
            awaiting_input: true,
          },
        ])
        .mockResolvedValueOnce([]);
      setQueueJobs({});

      await service.reconcileNow('manual');

      expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
    });

    it('does not touch a stale RUNNING run that is parked on a dependency wait', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-dependency',
            current_step_id: 'await_dependency',
            updated_at: STALE,
            awaiting_input: false,
            wait_reason: 'dependency',
          },
        ])
        .mockResolvedValueOnce([]);
      setQueueJobs({});

      await service.reconcileNow('manual');

      expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
    });

    it('excludes a dependency-waiting run from failed-queue-job repair candidates', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-dependency',
            current_step_id: 'await_dependency',
            updated_at: STALE,
            awaiting_input: false,
            wait_reason: 'dependency',
          },
        ])
        .mockResolvedValueOnce([]);

      setQueueJobs({
        failed: [
          {
            id: 'queue-job-dependency',
            data: {
              workflowRunId: 'run-dependency',
              jobId: 'await_dependency',
            },
            failedReason: 'job stalled more than allowable limit',
          },
        ],
      });

      await service.reconcileNow('manual');

      expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
    });

    it('does not fail a stale RUNNING run that has a live execution with recent activity', async () => {
      const { service, runRepo, runExecution, executionRepo, setQueueJobs } =
        createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-agent-busy',
            current_step_id: 'bootstrap',
            updated_at: STALE,
            awaiting_input: false,
          },
        ])
        .mockResolvedValueOnce([]);
      setQueueJobs({});
      // Fire-and-poll dispatch: no BullMQ job while the agent works, but the
      // execution record is alive and heartbeating from container activity.
      executionRepo.findNonTerminal.mockResolvedValue([
        {
          id: 'exec-live',
          kind: 'workflow_step',
          state: 'running',
          workflow_run_id: 'run-agent-busy',
          created_at: STALE,
          updated_at: STALE,
          last_heartbeat_at: FRESH,
        },
      ]);

      await service.reconcileNow('manual');

      expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
    });

    it('immunises a stale RUNNING run whose workflow_step container is still alive', async () => {
      const {
        service,
        runRepo,
        runExecution,
        executionRepo,
        containerLiveness,
        setQueueJobs,
      } = createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-long-gate',
            current_step_id: 'quality_gate',
            updated_at: STALE,
            awaiting_input: false,
          },
        ])
        .mockResolvedValueOnce([]);
      setQueueJobs({});
      // A long-running run_command step (e.g. the merge quality gate's full test
      // suite) does not heartbeat while its output is buffered, so its execution
      // looks stale — but its container is alive and still doing work.
      executionRepo.findNonTerminal.mockResolvedValue([
        {
          id: 'exec-gate',
          kind: 'workflow_step',
          state: 'running',
          workflow_run_id: 'run-long-gate',
          container_id: 'container-gate-1',
          created_at: STALE,
          updated_at: STALE,
          last_heartbeat_at: STALE,
        },
      ]);
      containerLiveness.isContainerLost.mockResolvedValue(false);

      await service.reconcileNow('manual');

      expect(containerLiveness.isContainerLost).toHaveBeenCalledWith(
        'container-gate-1',
      );
      expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
    });

    it('still fails a stale RUNNING run whose executions have no recent activity', async () => {
      const { service, runRepo, runExecution, executionRepo, setQueueJobs } =
        createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-dead',
            current_step_id: 'bootstrap',
            updated_at: STALE,
            awaiting_input: false,
          },
        ])
        .mockResolvedValueOnce([]);
      setQueueJobs({});
      // A legacy execution row stuck without activity must not immunise the run.
      executionRepo.findNonTerminal.mockResolvedValue([
        {
          id: 'exec-stuck',
          kind: 'workflow_step',
          state: 'pending',
          workflow_run_id: 'run-dead',
          created_at: STALE,
          updated_at: STALE,
          last_heartbeat_at: null,
        },
      ]);

      await service.reconcileNow('manual');

      expect(runExecution.handleJobFailed).toHaveBeenCalledWith(
        'run-dead',
        'bootstrap',
        expect.stringContaining('stale-run watchdog'),
        undefined,
      );
    });

    it('skips a stale RUNNING run that has no current_step_id', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-no-step',
            current_step_id: undefined,
            updated_at: STALE,
            awaiting_input: false,
          },
        ])
        .mockResolvedValueOnce([]);
      setQueueJobs({});

      await service.reconcileNow('manual');

      expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
    });

    it('recovers the started-but-incomplete job, not the frozen current_step_id (the incident shape)', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-incident',
            current_step_id: 'capture_charter',
            updated_at: STALE,
            awaiting_input: false,
            state_variables: {
              jobs: {
                refine_charter: { steps: { refine: { status: 'running' } } },
                capture_charter: { result: 'skipped' },
                capture_charter_brownfield: { result: 'skipped' },
              },
              _internal: {
                current_job_id: 'refine_charter',
                completed_jobs: {
                  capture_charter: true,
                  capture_charter_brownfield: true,
                },
              },
            },
          },
        ])
        .mockResolvedValueOnce([]);
      setQueueJobs({});

      await service.reconcileNow('manual');

      expect(runExecution.handleJobFailed).toHaveBeenCalledTimes(1);
      expect(runExecution.handleJobFailed).toHaveBeenCalledWith(
        'run-incident',
        'refine_charter',
        expect.stringContaining('stale-run watchdog'),
        undefined,
      );
      expect(runExecution.handleJobFailed).not.toHaveBeenCalledWith(
        'run-incident',
        'capture_charter',
        expect.anything(),
        undefined,
      );
    });

    it('keeps recovering remaining stalled jobs when handleJobFailed throws on one (parallel-job run)', async () => {
      const { service, runRepo, runExecution, setQueueJobs } = createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-parallel',
            current_step_id: 'job_a',
            updated_at: STALE,
            awaiting_input: false,
            state_variables: {
              jobs: {
                job_a: { steps: { run: { status: 'running' } } },
                job_b: { steps: { run: { status: 'running' } } },
              },
              _internal: {
                completed_jobs: {},
              },
            },
          },
        ]) // RUNNING
        .mockResolvedValueOnce([]); // PENDING
      setQueueJobs({});

      runExecution.handleJobFailed.mockImplementation((_runId, jobId) => {
        if (jobId === 'job_a') {
          return Promise.reject(new Error('transient db error'));
        }
        return Promise.resolve('failed');
      });

      await service.reconcileNow('manual');

      // A failure recovering job_a must not abort recovery of job_b.
      expect(runExecution.handleJobFailed).toHaveBeenCalledWith(
        'run-parallel',
        'job_a',
        expect.stringContaining('stale-run watchdog'),
        undefined,
      );
      expect(runExecution.handleJobFailed).toHaveBeenCalledWith(
        'run-parallel',
        'job_b',
        expect.stringContaining('stale-run watchdog'),
        undefined,
      );
      expect(runExecution.handleJobFailed).toHaveBeenCalledTimes(2);
    });

    it('does not touch a stale RUNNING run that still has an open user question row', async () => {
      const {
        service,
        runRepo,
        runExecution,
        questionAwaitRepo,
        setQueueJobs,
      } = createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-parked-question',
            current_step_id: 'capture_charter',
            updated_at: STALE,
            awaiting_input: false,
          },
        ])
        .mockResolvedValueOnce([]);
      questionAwaitRepo.findRunIdsWithOpenQuestions.mockResolvedValue(
        new Set(['run-parked-question']),
      );
      setQueueJobs({});

      await service.reconcileNow('manual');

      expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
    });

    it('immunises a run whose only fresh activity is a live child subagent, even when the parent step row looks stale', async () => {
      const { service, runRepo, runExecution, executionRepo, setQueueJobs } =
        createService();

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-child-busy',
            current_step_id: 'implement_and_commit',
            updated_at: STALE,
            awaiting_input: false,
          },
        ])
        .mockResolvedValueOnce([]);
      setQueueJobs({});

      // Stale parent workflow_step (no heartbeat, created 45 min ago) plus a
      // fresh child subagent (heartbeat 10s ago). The structural fallback must
      // prevent the watchdog from reaping the run while the child is live.
      executionRepo.findNonTerminal.mockResolvedValue([
        {
          id: 'parent',
          kind: 'workflow_step',
          workflow_run_id: 'run-child-busy',
          container_id: 'c1',
          created_at: new Date(Date.now() - 45 * 60_000),
          last_heartbeat_at: null,
          updated_at: new Date(Date.now() - 45 * 60_000),
        },
        {
          id: 'child',
          kind: 'subagent',
          workflow_run_id: 'run-child-busy',
          parent_container_id: 'c1',
          last_heartbeat_at: new Date(Date.now() - 10_000),
          created_at: new Date(Date.now() - 45 * 60_000),
          updated_at: new Date(Date.now() - 10_000),
        },
      ]);

      await service.reconcileNow('manual');

      expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
    });
  });

  it('does not rebroadcast historical failed runs during reconciliation', async () => {
    const { service, runRepo, setQueueJobs } = createService();

    runRepo.findByStatus.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    setQueueJobs({});

    await service.reconcileNow('manual');

    expect(runRepo.findByStatus).toHaveBeenCalledTimes(2);
    expect(runRepo.findByStatus).toHaveBeenNthCalledWith(
      1,
      WorkflowStatus.RUNNING,
    );
    expect(runRepo.findByStatus).toHaveBeenNthCalledWith(
      2,
      WorkflowStatus.PENDING,
    );
  });

  describe('shutdown gate', () => {
    it('skips the reconcile entirely when the API is shutting down', async () => {
      const shuttingDownState = new ShutdownStateService();
      vi.spyOn(shuttingDownState, 'isShuttingDown').mockReturnValue(true);
      const { service, runRepo, stepQueue } = createService(
        createRunningLifecycle(),
        shuttingDownState,
      );

      await service.reconcileNow('interval');

      expect(runRepo.findByStatus).not.toHaveBeenCalled();
      expect(stepQueue.getJobs).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle guard', () => {
    it('returns early and skips all queue work when reaping is suspended (booting)', async () => {
      const bootingLifecycle = new ServiceLifecycleStateService();
      // Default phase is 'booting', so isReapingSuspended() returns true.
      const { service, stepQueue, runRepo } = createService(bootingLifecycle);

      await service.reconcileNow('interval');

      expect(stepQueue.getJobs).not.toHaveBeenCalled();
      expect(runRepo.findByStatus).not.toHaveBeenCalled();
    });
  });

  describe('frozen execution immunisation', () => {
    const STALE = new Date('2020-01-01T00:00:00.000Z');

    it('does not recover a stale RUNNING run whose only non-terminal execution is frozen', async () => {
      const { service, runRepo, runExecution, executionRepo, setQueueJobs } =
        createService(); // lifecycle is RUNNING — only the frozen flag prevents recovery

      runRepo.findByStatus
        .mockResolvedValueOnce([
          {
            id: 'run-frozen',
            current_step_id: 'bootstrap',
            updated_at: STALE,
            awaiting_input: false,
          },
        ])
        .mockResolvedValueOnce([]);
      setQueueJobs({});

      // The execution is frozen with a stale heartbeat (container is paused).
      executionRepo.findNonTerminal.mockResolvedValue([
        {
          id: 'exec-frozen',
          kind: 'workflow_step',
          state: 'running',
          workflow_run_id: 'run-frozen',
          frozen: true,
          created_at: STALE,
          updated_at: STALE,
          last_heartbeat_at: STALE,
        },
      ]);

      await service.reconcileNow('manual');

      expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
    });
  });
});
