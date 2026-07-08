import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import { WorkflowAutoRetryActivationGuardService } from './workflow-auto-retry-activation-guard.service';

const makeData = () =>
  ({
    workflowRunId: 'run-1',
    jobId: 'job-1',
    job: { id: 'job-1' },
    autoRetry: {
      attempt: 2,
      retryQueueJobId: 'auto-retry-run-1-job-1',
    },
  }) as any;

describe('WorkflowAutoRetryActivationGuardService', () => {
  const runRepo = { findById: vi.fn() };
  const stateManager = { getVariable: vi.fn(), deleteVariable: vi.fn() };
  let service: WorkflowAutoRetryActivationGuardService;

  beforeEach(() => {
    vi.clearAllMocks();
    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      status: WorkflowStatus.RUNNING,
      current_step_id: 'job-1',
    });
    stateManager.getVariable.mockImplementation((_runId, path) => {
      if (path.endsWith('.attempt')) return Promise.resolve(2);
      return Promise.resolve({
        attempt: 2,
        retryQueueJobId: 'auto-retry-run-1-job-1',
      });
    });
    stateManager.deleteVariable.mockResolvedValue(undefined);
    service = new WorkflowAutoRetryActivationGuardService(
      runRepo as never,
      stateManager as never,
    );
  });

  it('does not guard non-auto-retry queue jobs', async () => {
    const { autoRetry: _autoRetry, ...data } = makeData();

    await expect(
      service.shouldSkipStaleAutoRetryJob({
        queueJobId: 'workflow-step-run-1-job-1',
        data: data,
      }),
    ).resolves.toBe(false);
    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it('skips jobs with auto-retry metadata but non-auto-retry queue ids', async () => {
    await expect(
      service.shouldSkipStaleAutoRetryJob({
        queueJobId: 'workflow-step-run-1-job-1',
        data: makeData(),
      }),
    ).resolves.toBe(true);
    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it('allows matching auto-retry jobs', async () => {
    await expect(
      service.shouldSkipStaleAutoRetryJob({
        queueJobId: 'auto-retry-run-1-job-1',
        data: makeData(),
      }),
    ).resolves.toBe(false);
  });

  it('skips auto-retry jobs with missing queue metadata', async () => {
    const { autoRetry: _autoRetry, ...data } = makeData();

    await expect(
      service.shouldSkipStaleAutoRetryJob({
        queueJobId: 'auto-retry-run-1-job-1',
        data: data,
      }),
    ).resolves.toBe(true);
  });

  it('skips auto-retry jobs for terminal runs', async () => {
    runRepo.findById.mockResolvedValueOnce({
      id: 'run-1',
      status: WorkflowStatus.COMPLETED,
      current_step_id: 'job-1',
    });

    await expect(
      service.shouldSkipStaleAutoRetryJob({
        queueJobId: 'auto-retry-run-1-job-1',
        data: makeData(),
      }),
    ).resolves.toBe(true);
  });

  it('clears the pending-retry marker when an auto-retry job activates', async () => {
    await service.markAutoRetryActivated(makeData());

    expect(stateManager.deleteVariable).toHaveBeenCalledWith(
      'run-1',
      '_internal.auto_retry.job-1.last_failure',
    );
  });

  it('skips auto-retry jobs with stale persisted attempt metadata', async () => {
    stateManager.getVariable.mockImplementation((_runId, path) => {
      if (path.endsWith('.attempt')) return Promise.resolve(3);
      return Promise.resolve({
        attempt: 3,
        retryQueueJobId: 'auto-retry-run-1-job-1',
      });
    });

    await expect(
      service.shouldSkipStaleAutoRetryJob({
        queueJobId: 'auto-retry-run-1-job-1',
        data: makeData(),
      }),
    ).resolves.toBe(true);
  });
});
