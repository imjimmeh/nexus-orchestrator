import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import { WorkflowAuditListener } from './workflow-audit.listener';
import { WorkflowEventLogService } from '../workflow-event-log.service';
import type {
  WorkflowRunEvent,
  WorkflowJobEvent,
  WorkflowCoreLifecycleEvent,
} from '../workflow-events.types';

describe('WorkflowAuditListener', () => {
  let listener: WorkflowAuditListener;
  let eventLog: { appendBestEffort: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    eventLog = { appendBestEffort: vi.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        WorkflowAuditListener,
        { provide: WorkflowEventLogService, useValue: eventLog },
      ],
    }).compile();

    listener = module.get(WorkflowAuditListener);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const runEvent = (): WorkflowRunEvent => ({
    workflowRunId: 'run-1',
    workflowId: 'wf-1',
    status: WorkflowStatus.RUNNING,
    stateVariables: {},
  });

  const jobEvent = (): WorkflowJobEvent => ({
    workflowRunId: 'run-1',
    jobId: 'job-1',
  });

  describe('run-level events', () => {
    it('logs workflow.started on run started', async () => {
      await listener.onRunStarted({
        ...runEvent(),
        triggerData: { foo: 'bar' },
      });
      expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: 'run-1',
          eventType: 'workflow.started',
        }),
      );
    });

    it('logs workflow.completed on run completed', async () => {
      await listener.onRunCompleted(runEvent());
      expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: 'run-1',
          eventType: 'workflow.completed',
        }),
      );
    });

    it('logs workflow.failed on run failed', async () => {
      await listener.onRunFailed({ ...runEvent(), reason: 'oops' });
      expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: 'run-1',
          eventType: 'workflow.failed',
        }),
      );
    });

    it('logs workflow.cancelled on run cancelled', async () => {
      await listener.onRunCancelled({
        ...runEvent(),
        reason: 'user cancelled',
      });
      expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: 'run-1',
          eventType: 'workflow.cancelled',
        }),
      );
    });

    it('logs workflow.paused on run paused', async () => {
      await listener.onRunPaused(runEvent());
      expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: 'run-1',
          eventType: 'workflow.paused',
        }),
      );
    });

    it('logs workflow.resumed on run resumed', async () => {
      await listener.onRunResumed(runEvent());
      expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: 'run-1',
          eventType: 'workflow.resumed',
        }),
      );
    });
  });

  describe('job-level events', () => {
    it('logs job.queued', async () => {
      await listener.onJobQueued({ ...jobEvent(), payload: { type: 'agent' } });
      expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: 'run-1',
          eventType: 'job.queued',
          jobId: 'job-1',
        }),
      );
    });

    it('logs job.completed', async () => {
      await listener.onJobCompleted(jobEvent());
      expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: 'run-1',
          eventType: 'job.completed',
          jobId: 'job-1',
        }),
      );
    });

    it('logs job.failed', async () => {
      await listener.onJobFailed({ ...jobEvent(), reason: 'timeout' });
      expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: 'run-1',
          eventType: 'job.failed',
          jobId: 'job-1',
        }),
      );
    });

    it('logs workflow.retry_scheduled', async () => {
      await listener.onRetryScheduled(jobEvent());
      expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: 'run-1',
          eventType: 'workflow.retry_scheduled',
        }),
      );
    });

    it('records scheduled retries as in_progress, not success', async () => {
      await listener.onRetryScheduled({
        workflowRunId: 'run-1',
        workflowId: 'wf-1',
        jobId: 'apply_qa_decision',
        payload: { attempt: 1, reasonCode: 'resource_contention' },
      });

      const arg = eventLog.appendBestEffort.mock.calls[0][0];
      expect(arg.eventType).toBe('workflow.retry_scheduled');
      expect(arg.outcome).toBe('in_progress');
      expect(arg.severity).toBe('warn');
    });
  });

  describe('queue activation events', () => {
    it('logs workflow.activated_from_queue', async () => {
      await listener.onActivatedFromQueue({ workflowRunId: 'run-2' });
      expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: 'run-2',
          eventType: 'workflow.activated_from_queue',
        }),
      );
    });
  });

  describe('core lifecycle events', () => {
    it('logs core lifecycle event', async () => {
      const event: WorkflowCoreLifecycleEvent = {
        runId: 'run-1',
        workflowId: 'wf-1',
        envelope: {
          event_id: 'evt-1',
          event_type: 'core.workflow.run.accepted.v1',
          event_version: 'v1',
          occurred_at: new Date().toISOString(),
          correlation_id: 'corr-1',
          source_service: 'core',
          payload: {
            run_id: 'run-1',
            workflow_id: 'wf-1',
            status: WorkflowStatus.RUNNING,
            context: null,
          },
        },
      };
      await listener.onCoreLifecycle(event);
      expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: 'run-1',
          eventType: 'core.workflow.run.accepted.v1',
        }),
      );
    });
  });
});
