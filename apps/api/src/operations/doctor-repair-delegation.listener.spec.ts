import { EventEmitter2 } from '@nestjs/event-emitter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoctorRepairExecutorService } from './doctor-repair-executor.service';
import type { DoctorRepairExecutionResult } from './doctor.types';
import { DoctorRepairDelegationListener } from './doctor-repair-delegation.listener';
import {
  REPAIR_DELEGATION_COMPLETED_EVENT,
  type RepairDelegationCompletedEvent,
  type RepairDelegationRequestEvent,
} from '../workflow/workflow-repair/repair-delegation.types';

describe('DoctorRepairDelegationListener', () => {
  const executeMock = vi.fn();
  const emitMock = vi.fn();

  const doctorRepairExecutor = {
    execute: executeMock,
  } as unknown as DoctorRepairExecutorService;

  const eventEmitter = {
    emit: emitMock,
  } as unknown as EventEmitter2;

  let listener: DoctorRepairDelegationListener;

  beforeEach(() => {
    vi.clearAllMocks();
    listener = new DoctorRepairDelegationListener(
      doctorRepairExecutor,
      eventEmitter,
    );
  });

  it('executes DoctorRepairExecutorService.execute with concrete action and correct arguments', async () => {
    executeMock.mockResolvedValue(createDoctorResult({ status: 'succeeded' }));

    await listener.handleDoctorRepairRequested(createDoctorRequestedEvent());

    expect(executeMock).toHaveBeenCalledWith({
      action_id: 'prune_orphaned_runtime_artifacts',
      dry_run: false,
      requested_by: 'workflow_repair_delegation',
      arguments: {
        workflowRunId: 'workflow-run-1',
        failedJobId: 'failed-job-1',
        validationMessage: 'stale runtime artifacts',
        policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
        repairAttempt: 2,
      },
    });
  });

  it('forwards the sanitized failure reason as validationMessage so the executor can pass corrective feedback', async () => {
    executeMock.mockResolvedValue(createDoctorResult({ status: 'succeeded' }));

    await listener.handleDoctorRepairRequested(
      createDoctorRequestedEvent({
        decision: {
          class: 'split_coverage_invalid',
          reason: 'Downstream validation rejected the produced output.',
          confidence: 0.95,
          evidenceReferences: [],
          eligibility: 'allow',
          allowedRepairActionIds: ['redispatch_producer_job_with_feedback'],
        },
      }),
    );

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: expect.objectContaining({
          validationMessage:
            'Downstream validation rejected the produced output.',
        }),
      }),
    );
  });

  it.each(['succeeded', 'partial'] as const)(
    'emits succeeded completion for doctor status %s',
    async (status) => {
      executeMock.mockResolvedValue(createDoctorResult({ status }));

      await listener.handleDoctorRepairRequested(createDoctorRequestedEvent());

      expect(emitMock).toHaveBeenCalledWith(
        REPAIR_DELEGATION_COMPLETED_EVENT,
        createCompletionEvent({
          status: 'succeeded',
          message: 'Doctor repair completed',
          doctorRepairAttemptId: 'doctor-attempt-1',
        }),
      );
    },
  );

  it('emits failed completion for doctor status failed', async () => {
    executeMock.mockResolvedValue(
      createDoctorResult({ status: 'failed', message: 'Repair failed' }),
    );

    await listener.handleDoctorRepairRequested(createDoctorRequestedEvent());

    expect(emitMock).toHaveBeenCalledWith(
      REPAIR_DELEGATION_COMPLETED_EVENT,
      createCompletionEvent({
        status: 'failed',
        message: 'Repair failed',
        doctorRepairAttemptId: 'doctor-attempt-1',
      }),
    );
  });

  it('emits failed completion and skips executor when concreteActionId is missing', async () => {
    await listener.handleDoctorRepairRequested(
      createDoctorRequestedEvent({ concreteActionId: undefined }),
    );

    expect(executeMock).not.toHaveBeenCalled();
    expect(emitMock).toHaveBeenCalledWith(
      REPAIR_DELEGATION_COMPLETED_EVENT,
      expect.objectContaining({
        status: 'failed',
        message: 'Missing concrete doctor repair action id',
      }),
    );
  });

  it('emits failed completion on executor exception', async () => {
    executeMock.mockRejectedValue(new Error('Executor unavailable'));

    await expect(
      listener.handleDoctorRepairRequested(createDoctorRequestedEvent()),
    ).resolves.toBeUndefined();

    expect(emitMock).toHaveBeenCalledWith(
      REPAIR_DELEGATION_COMPLETED_EVENT,
      expect.objectContaining({
        workflowRunId: 'workflow-run-1',
        workflowId: 'workflow-1',
        failedJobId: 'failed-job-1',
        policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
        executionPath: 'doctor',
        attempt: 2,
        status: 'failed',
        message: 'Executor unavailable',
      }),
    );
  });
});

function createDoctorRequestedEvent(
  overrides: Partial<RepairDelegationRequestEvent> = {},
): RepairDelegationRequestEvent {
  return {
    workflowRunId: 'workflow-run-1',
    workflowId: 'workflow-1',
    failedJobId: 'failed-job-1',
    decision: {
      class: 'runtime_artifact_stale',
      reason: 'stale runtime artifacts',
      confidence: 0.9,
      evidenceReferences: [],
      eligibility: 'allow',
      allowedRepairActionIds: [
        'doctor.runtime_artifact.refresh_stale_artifacts',
      ],
    },
    policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
    concreteActionId: 'prune_orphaned_runtime_artifacts',
    attempt: 2,
    ...overrides,
  };
}

function createCompletionEvent(
  overrides: Partial<RepairDelegationCompletedEvent> = {},
): RepairDelegationCompletedEvent {
  return {
    workflowRunId: 'workflow-run-1',
    workflowId: 'workflow-1',
    failedJobId: 'failed-job-1',
    policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
    executionPath: 'doctor',
    attempt: 2,
    status: 'succeeded',
    message: 'Doctor repair completed',
    ...overrides,
  };
}

function createDoctorResult(
  overrides: Partial<DoctorRepairExecutionResult> = {},
): DoctorRepairExecutionResult {
  return {
    attempt_id: 'doctor-attempt-1',
    action_id: 'prune_orphaned_runtime_artifacts',
    status: 'succeeded',
    dry_run: false,
    started_at: '2026-04-12T00:00:00.000Z',
    finished_at: '2026-04-12T00:00:01.000Z',
    message: 'Doctor repair completed',
    changes: {},
    evidence: {},
    ...overrides,
  };
}
