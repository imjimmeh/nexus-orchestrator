import { WorkflowStatus, ScheduledJobRunStatus } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledJobRunRepository } from './database/repositories/scheduled-job-run.repository';
import { ScheduledJobRunStatusListener } from './scheduled-job-run-status.listener';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';

describe('ScheduledJobRunStatusListener', () => {
  const updateByWorkflowRunIdMock = vi.fn();

  const runRepository = {
    updateByWorkflowRunId: updateByWorkflowRunIdMock,
  } as unknown as ScheduledJobRunRepository;

  let listener: ScheduledJobRunStatusListener;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-12T11:00:00.000Z'));
    listener = new ScheduledJobRunStatusListener(runRepository);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const event = (runId: string, status: WorkflowStatus): WorkflowRunEvent => ({
    workflowRunId: runId,
    workflowId: 'wf-1',
    status,
    stateVariables: {},
  });

  it('marks run as running when run starts', async () => {
    await listener.onRunStartedOrResumed(
      event('wf-run-1', WorkflowStatus.RUNNING),
    );

    expect(updateByWorkflowRunIdMock).toHaveBeenCalledWith('wf-run-1', {
      status: ScheduledJobRunStatus.RUNNING,
    });
  });

  it('marks run as running when run resumes', async () => {
    await listener.onRunStartedOrResumed(
      event('wf-run-1', WorkflowStatus.RUNNING),
    );

    expect(updateByWorkflowRunIdMock).toHaveBeenCalledWith('wf-run-1', {
      status: ScheduledJobRunStatus.RUNNING,
    });
  });

  it('marks run as succeeded when run completes', async () => {
    await listener.onRunCompleted(event('wf-run-2', WorkflowStatus.COMPLETED));

    expect(updateByWorkflowRunIdMock).toHaveBeenCalledWith(
      'wf-run-2',
      expect.objectContaining({
        status: ScheduledJobRunStatus.SUCCEEDED,
        finished_at: new Date('2026-04-12T11:00:00.000Z'),
      }),
    );
  });

  it('marks run as failed when run fails', async () => {
    await listener.onRunFailed(event('wf-run-3', WorkflowStatus.FAILED));

    expect(updateByWorkflowRunIdMock).toHaveBeenCalledWith(
      'wf-run-3',
      expect.objectContaining({
        status: ScheduledJobRunStatus.FAILED,
        error_code: 'workflow_failed',
      }),
    );
  });

  it('marks run as cancelled when run is cancelled', async () => {
    await listener.onRunCancelled(event('wf-run-4', WorkflowStatus.CANCELLED));

    expect(updateByWorkflowRunIdMock).toHaveBeenCalledWith(
      'wf-run-4',
      expect.objectContaining({
        status: ScheduledJobRunStatus.CANCELLED,
        error_code: 'workflow_cancelled',
      }),
    );
  });
});
