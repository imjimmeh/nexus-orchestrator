import { WorkflowStatus } from '@nexus/core';
import { describe, expect, it, vi } from 'vitest';
import { SysadminRepairCompletionListener } from './sysadmin-repair-completion.listener';
import { REPAIR_DELEGATION_COMPLETED_EVENT } from './repair-delegation.types';

function createListener() {
  const workflowRepo = {
    findByIdentifier: vi.fn(),
  };
  const eventEmitter = {
    emit: vi.fn(),
  };

  const listener = new SysadminRepairCompletionListener(
    workflowRepo as never,
    eventEmitter,
  );

  return { listener, workflowRepo, eventEmitter };
}

function completionEvent(overrides: Record<string, unknown> = {}) {
  return {
    workflowRunId: 'repair-run-1',
    workflowId: 'repair-workflow-id',
    status: WorkflowStatus.COMPLETED,
    stateVariables: {
      trigger: {
        workflowRunId: 'original-run-1',
        workflowId: 'original-workflow-1',
        failedJobId: 'failed-job-1',
        policyActionId: 'repair.config.create_local_placeholder',
        attempt: 2,
      },
      jobs: {
        repair_environment: {
          output: {
            status: 'succeeded',
            summary: 'Created missing local config placeholder.',
          },
        },
      },
    },
    ...overrides,
  };
}

describe('SysadminRepairCompletionListener', () => {
  it('ignores non-environment-repair workflow completion', async () => {
    const { listener, workflowRepo, eventEmitter } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: 'repair-workflow-id',
    });

    await listener.handleWorkflowCompleted(
      completionEvent({ workflowId: 'other-workflow-id' }),
    );

    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('emits succeeded completion when output status is succeeded', async () => {
    const { listener, workflowRepo, eventEmitter } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: 'repair-workflow-id',
    });

    await listener.handleWorkflowCompleted(completionEvent());

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      REPAIR_DELEGATION_COMPLETED_EVENT,
      expect.objectContaining({
        status: 'succeeded',
        message: 'Created missing local config placeholder.',
        executionPath: 'sysadmin_workflow',
      }),
    );
  });

  it('emits completion once for duplicate repair workflow run completion delivery', async () => {
    const { listener, workflowRepo, eventEmitter } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: 'repair-workflow-id',
    });
    const event = completionEvent();

    await listener.handleWorkflowCompleted(event);
    await listener.handleWorkflowCompleted(event);

    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('redacts and truncates summary before emitting completion message', async () => {
    const { listener, workflowRepo, eventEmitter } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: 'repair-workflow-id',
    });

    await listener.handleWorkflowCompleted(
      completionEvent({
        stateVariables: {
          trigger: {
            workflowRunId: 'original-run-1',
            workflowId: 'original-workflow-1',
            failedJobId: 'failed-job-1',
            policyActionId: 'repair.config.create_local_placeholder',
            attempt: 2,
          },
          jobs: {
            repair_environment: {
              output: {
                status: 'succeeded',
                summary: `Created placeholder with "token":"abc123" api_key=def456 apiKey: "ghi 789" password is hunter two. secret=sauce bearer: xyz credential: |
line-one
line-two
${'x'.repeat(600)}`,
              },
            },
          },
        },
      }),
    );

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      REPAIR_DELEGATION_COMPLETED_EVENT,
      expect.objectContaining({
        message: expect.not.stringContaining('abc123'),
      }),
    );
    const [, emittedEvent] = eventEmitter.emit.mock.calls[0];
    expect(emittedEvent.message).toContain('"token":"[REDACTED]"');
    expect(emittedEvent.message).toContain('api_key=[REDACTED]');
    expect(emittedEvent.message).toContain('apiKey: "[REDACTED]"');
    expect(emittedEvent.message).toContain('password is [REDACTED]');
    expect(emittedEvent.message).toContain('secret=[REDACTED]');
    expect(emittedEvent.message).toContain('bearer: [REDACTED]');
    expect(emittedEvent.message).toContain('credential: [REDACTED]');
    expect(emittedEvent.message).not.toContain('def456');
    expect(emittedEvent.message).not.toContain('ghi 789');
    expect(emittedEvent.message).not.toContain('hunter two');
    expect(emittedEvent.message).not.toContain('xyz');
    expect(emittedEvent.message).not.toContain('line-one');
    expect(emittedEvent.message.length).toBeLessThanOrEqual(500);
    expect(emittedEvent.message).toContain('[truncated]');
  });

  it('emits failed completion when output status is failed', async () => {
    const { listener, workflowRepo, eventEmitter } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: 'repair-workflow-id',
    });

    await listener.handleWorkflowCompleted(
      completionEvent({
        stateVariables: {
          trigger: {
            workflowRunId: 'original-run-1',
            workflowId: 'original-workflow-1',
            failedJobId: 'failed-job-1',
            policyActionId: 'repair.config.create_local_placeholder',
            attempt: 2,
          },
          jobs: {
            repair_environment: {
              output: {
                status: 'failed',
                summary: 'Unable to create config placeholder.',
              },
            },
          },
        },
      }),
    );

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      REPAIR_DELEGATION_COMPLETED_EVENT,
      expect.objectContaining({
        status: 'failed',
        message: 'Unable to create config placeholder.',
      }),
    );
  });

  it('emits failed completion when output status is missing or invalid', async () => {
    const { listener, workflowRepo, eventEmitter } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: 'repair-workflow-id',
    });

    await listener.handleWorkflowCompleted(
      completionEvent({
        stateVariables: {
          trigger: {
            workflowRunId: 'original-run-1',
            workflowId: 'original-workflow-1',
            failedJobId: 'failed-job-1',
            policyActionId: 'repair.config.create_local_placeholder',
            attempt: 2,
          },
          jobs: {
            repair_environment: {
              output: {
                status: 'unexpected',
              },
            },
          },
        },
      }),
    );

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      REPAIR_DELEGATION_COMPLETED_EVENT,
      expect.objectContaining({
        status: 'failed',
        message: expect.stringContaining('did not report a valid status'),
      }),
    );
  });

  it('includes original IDs, policy action, attempt, and repair workflow run id', async () => {
    const { listener, workflowRepo, eventEmitter } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: 'repair-workflow-id',
    });

    await listener.handleWorkflowCompleted(completionEvent());

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      REPAIR_DELEGATION_COMPLETED_EVENT,
      {
        workflowRunId: 'original-run-1',
        workflowId: 'original-workflow-1',
        failedJobId: 'failed-job-1',
        policyActionId: 'repair.config.create_local_placeholder',
        executionPath: 'sysadmin_workflow',
        attempt: 2,
        status: 'succeeded',
        message: 'Created missing local config placeholder.',
        repairWorkflowRunId: 'repair-run-1',
      },
    );
  });

  it('does not throw when trigger context is missing', async () => {
    const { listener, workflowRepo, eventEmitter } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: 'repair-workflow-id',
    });
    const warnSpy = vi
      .spyOn(listener['logger'], 'warn')
      .mockImplementation(() => undefined);

    await expect(
      listener.handleWorkflowCompleted(
        completionEvent({
          stateVariables: {
            jobs: {
              repair_environment: {
                output: { status: 'succeeded' },
              },
            },
          },
        }),
      ),
    ).resolves.toBeUndefined();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Skipping sysadmin repair completion for run repair-run-1: missing original repair context.',
    );
    warnSpy.mockRestore();
  });

  it('does not throw and emits failed fallback when output is malformed', async () => {
    const { listener, workflowRepo, eventEmitter } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: 'repair-workflow-id',
    });

    await expect(
      listener.handleWorkflowCompleted(
        completionEvent({
          stateVariables: {
            trigger: {
              workflowRunId: 'original-run-1',
              workflowId: 'original-workflow-1',
              failedJobId: 'failed-job-1',
              policyActionId: 'repair.config.create_local_placeholder',
              attempt: 2,
            },
            jobs: {
              repair_environment: {
                output: ['not', 'an', 'object'],
              },
            },
          },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      REPAIR_DELEGATION_COMPLETED_EVENT,
      expect.objectContaining({
        status: 'failed',
        message: 'Sysadmin repair workflow did not report a valid status.',
      }),
    );
  });
});
