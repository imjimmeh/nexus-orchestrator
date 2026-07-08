import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import { RetrospectiveEnqueueListener } from './retrospective-enqueue.listener';

describe('RetrospectiveEnqueueListener', () => {
  let enqueueService: any;
  let listener: RetrospectiveEnqueueListener;

  beforeEach(() => {
    enqueueService = {
      enqueueWorkflowRun: vi.fn(),
    };
    listener = new RetrospectiveEnqueueListener(enqueueService);
  });

  it('delegates handleWorkflowRunCompleted to service', async () => {
    const event = { workflowRunId: 'run-1' } as any;
    await listener.handleWorkflowRunCompleted(event);

    expect(enqueueService.enqueueWorkflowRun).toHaveBeenCalledWith(
      event,
      'completed',
    );
  });

  it('delegates handleWorkflowRunFailed to service', async () => {
    const event = { workflowRunId: 'run-2' } as any;
    await listener.handleWorkflowRunFailed(event);

    expect(enqueueService.enqueueWorkflowRun).toHaveBeenCalledWith(
      event,
      'failed',
    );
  });
});
