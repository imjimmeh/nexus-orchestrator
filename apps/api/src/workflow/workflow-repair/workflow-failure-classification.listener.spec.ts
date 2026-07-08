import { Logger } from '@nestjs/common';
import { WorkflowStatus } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowFailureClassificationListener } from './workflow-failure-classification.listener';
import { WorkflowFailureClassificationService } from './workflow-failure-classification.service';
import type { WorkflowRunEvent } from '../workflow-events.types';
import { WorkflowRepairDispatchService } from './workflow-repair-dispatch.service';

describe('WorkflowFailureClassificationListener', () => {
  const classification = {
    classifyRunFailure: vi.fn().mockResolvedValue({
      class: 'dependency_missing',
      confidence: 0.9,
      reason: 'Package missing from local environment.',
      evidenceReferences: [],
      eligibility: 'allow',
      allowedRepairActionIds: ['repair.dependency.add_declared_package'],
    }),
  };
  const repairDispatch = {
    dispatchIfAllowed: vi.fn().mockResolvedValue(true),
  };

  let listener: WorkflowFailureClassificationListener;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    listener = new WorkflowFailureClassificationListener(
      classification as unknown as WorkflowFailureClassificationService,
      repairDispatch as unknown as WorkflowRepairDispatchService,
    );
  });

  it('classifies failed workflow runs best-effort', async () => {
    await listener.handleWorkflowRunFailed(event('run-1'));

    expect(classification.classifyRunFailure).toHaveBeenCalledWith('run-1');
  });

  it('calls dispatchIfAllowed after classification', async () => {
    const runEvent = event('run-3');

    await listener.handleWorkflowRunFailed(runEvent);
    const decision =
      await classification.classifyRunFailure.mock.results[0]?.value;

    expect(repairDispatch.dispatchIfAllowed).toHaveBeenCalledWith({
      workflowRunId: 'run-3',
      workflowId: 'workflow-1',
      decision,
    });
  });

  it('passes failedJobId from current step or trigger state', async () => {
    await listener.handleWorkflowRunFailed(
      event('run-5', { current_step_id: 'current-job' }),
    );
    await listener.handleWorkflowRunFailed(
      event('run-6', { trigger: { failed_job_id: 'trigger-job' } }),
    );

    expect(repairDispatch.dispatchIfAllowed).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ failedJobId: 'current-job' }),
    );
    expect(repairDispatch.dispatchIfAllowed).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ failedJobId: 'trigger-job' }),
    );
  });

  it('logs and swallows classification failures', async () => {
    classification.classifyRunFailure.mockRejectedValueOnce(
      new Error('collector unavailable'),
    );

    await expect(
      listener.handleWorkflowRunFailed(event('run-2')),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to classify workflow run run-2 failure'),
    );
    expect(repairDispatch.dispatchIfAllowed).not.toHaveBeenCalled();
  });

  it('logs and swallows repair dispatch failures', async () => {
    repairDispatch.dispatchIfAllowed.mockRejectedValueOnce(
      new Error('settings unavailable'),
    );

    await expect(
      listener.handleWorkflowRunFailed(event('run-4')),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to dispatch workflow repair for run run-4',
      ),
    );
  });
});

function event(
  workflowRunId: string,
  stateVariables: Record<string, unknown> = {},
): WorkflowRunEvent {
  return {
    workflowRunId,
    workflowId: 'workflow-1',
    status: WorkflowStatus.FAILED,
    stateVariables,
  };
}
