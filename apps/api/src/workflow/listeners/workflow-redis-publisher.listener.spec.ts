import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import { WorkflowRedisPublisherListener } from './workflow-redis-publisher.listener';
import { StepEventPublisherService } from '../workflow-step-execution/step-event-publisher.service';
import type { WorkflowRunEvent } from '../workflow-events.types';

describe('WorkflowRedisPublisherListener', () => {
  let listener: WorkflowRedisPublisherListener;
  let publisher: {
    publishBestEffort: ReturnType<typeof vi.fn>;
    createEvent: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    publisher = {
      publishBestEffort: vi.fn().mockResolvedValue(undefined),
      createEvent: vi
        .fn()
        .mockImplementation((type: string, payload: unknown) => ({
          type,
          payload,
        })),
    };

    const module = await Test.createTestingModule({
      providers: [
        WorkflowRedisPublisherListener,
        { provide: StepEventPublisherService, useValue: publisher },
      ],
    }).compile();

    listener = module.get(WorkflowRedisPublisherListener);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const runEvent = (
    status: WorkflowStatus = WorkflowStatus.RUNNING,
  ): WorkflowRunEvent => ({
    workflowRunId: 'run-1',
    workflowId: 'wf-1',
    status,
    stateVariables: {},
  });

  it('publishes workflow.run.started on run started', async () => {
    await listener.onRunStarted(runEvent());
    expect(publisher.createEvent).toHaveBeenCalledWith(
      'workflow.run.started',
      expect.objectContaining({ workflowRunId: 'run-1' }),
    );
    expect(publisher.publishBestEffort).toHaveBeenCalledWith(
      'run-1',
      expect.any(Object),
    );
  });

  it('publishes workflow.run.completed on run completed', async () => {
    await listener.onRunCompleted(runEvent(WorkflowStatus.COMPLETED));
    expect(publisher.createEvent).toHaveBeenCalledWith(
      'workflow.run.completed',
      expect.objectContaining({ workflowRunId: 'run-1' }),
    );
  });

  it('publishes workflow.run.failed on run failed', async () => {
    await listener.onRunFailed({
      ...runEvent(WorkflowStatus.FAILED),
      reason: 'oops',
    });
    expect(publisher.createEvent).toHaveBeenCalledWith(
      'workflow.run.failed',
      expect.objectContaining({ workflowRunId: 'run-1', reason: 'oops' }),
    );
  });

  it('publishes workflow.run.cancelled on run cancelled', async () => {
    await listener.onRunCancelled(runEvent(WorkflowStatus.CANCELLED));
    expect(publisher.createEvent).toHaveBeenCalledWith(
      'workflow.run.cancelled',
      expect.objectContaining({ workflowRunId: 'run-1' }),
    );
  });

  it('publishes workflow.run.paused on run paused', async () => {
    await listener.onRunPaused(runEvent(WorkflowStatus.PENDING));
    expect(publisher.createEvent).toHaveBeenCalledWith(
      'workflow.run.paused',
      expect.objectContaining({ workflowRunId: 'run-1' }),
    );
  });

  it('publishes workflow.run.resumed on run resumed', async () => {
    await listener.onRunResumed(runEvent(WorkflowStatus.RUNNING));
    expect(publisher.createEvent).toHaveBeenCalledWith(
      'workflow.run.resumed',
      expect.objectContaining({ workflowRunId: 'run-1' }),
    );
  });
});
