import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { EventLedgerService } from '../../observability/event-ledger.service';
import type { RuntimeFeedbackIngestionService } from '../../runtime-feedback/runtime-feedback-ingestion.service';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import {
  WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING,
  WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING,
} from '../../settings/repair-delegation-settings.constants';
import type { DoctorRepairExecutorService } from '../../operations/doctor-repair-executor.service';
import type { WorkflowRepository } from '../database/repositories/workflow.repository';
import { DoctorRepairDelegationListener } from '../../operations/doctor-repair-delegation.listener';
import type { StateManagerService } from '../state-manager.service';
import type { WorkflowFailedJobRetryService } from '../workflow-failed-job-retry.service';
import type { WorkflowRunEvent } from '../workflow-events.types';
import { WORKFLOW_RUN_COMPLETED_EVENT } from '../workflow-events.constants';
import { WorkflowFailureClassificationListener } from './workflow-failure-classification.listener';
import type { WorkflowFailureClassificationService } from './workflow-failure-classification.service';
import type { FailureClassificationDecision } from './failure-classification.types';
import {
  REPAIR_DELEGATION_AUDIT_EVENT,
  REPAIR_DELEGATION_COMPLETED_EVENT,
  REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT,
  REPAIR_DELEGATION_STATE_KEY,
  REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT,
  type WorkflowRepairDelegationState,
} from './repair-delegation.types';
import { WorkflowRepairCompletionListener } from './workflow-repair-completion.listener';
import { WorkflowRepairDispatchService } from './workflow-repair-dispatch.service';
import { SysadminRepairCompletionListener } from './sysadmin-repair-completion.listener';
import { RepairExecutorRegistryService } from './repair-executor-registry.service';

describe('workflow repair delegation integration', () => {
  const workflowRunId = 'workflow-run-1';
  const workflowId = 'workflow-1';
  const failedJobId = 'failed-job-1';

  let settingsEnabled: boolean;
  let maxAttempts: number;
  let stateStore: Map<string, unknown>;
  let eventBus: InMemoryEventBus;
  let eventLedger: { emitBestEffort: ReturnType<typeof vi.fn> };
  let workflowRepo: { findByIdentifier: ReturnType<typeof vi.fn> };
  let classification: { classifyRunFailure: ReturnType<typeof vi.fn> };
  let doctorRepairExecutor: { execute: ReturnType<typeof vi.fn> };
  let failedJobRetryService: {
    retryFailedJobWithMessage: ReturnType<typeof vi.fn>;
  };
  let runtimeFeedback: { ingest: ReturnType<typeof vi.fn> };
  let classificationListener: WorkflowFailureClassificationListener;

  beforeEach(() => {
    vi.clearAllMocks();
    settingsEnabled = true;
    maxAttempts = 1;
    stateStore = new Map();
    eventBus = new InMemoryEventBus();
    eventLedger = { emitBestEffort: vi.fn().mockResolvedValue(undefined) };
    workflowRepo = {
      findByIdentifier: vi.fn().mockResolvedValue({
        id: 'environment-repair-workflow-id',
        identifier: 'workflow_environment_repair',
      }),
    };
    classification = { classifyRunFailure: vi.fn() };
    doctorRepairExecutor = { execute: vi.fn() };
    failedJobRetryService = {
      retryFailedJobWithMessage: vi.fn().mockResolvedValue({ retried: true }),
    };
    runtimeFeedback = {
      ingest: vi.fn().mockResolvedValue({ promoted: false }),
    };

    const dispatchService = new WorkflowRepairDispatchService(
      createSettingsService(),
      createStateManager(),
      eventLedger as unknown as EventLedgerService,
      eventBus,
      new RepairExecutorRegistryService(),
    );
    const doctorListener = new DoctorRepairDelegationListener(
      doctorRepairExecutor as unknown as DoctorRepairExecutorService,
      eventBus,
    );
    const completionListener = new WorkflowRepairCompletionListener(
      createStateManager(),
      eventLedger as unknown as EventLedgerService,
      failedJobRetryService as unknown as WorkflowFailedJobRetryService,
      runtimeFeedback as unknown as RuntimeFeedbackIngestionService,
    );
    const sysadminCompletionListener = new SysadminRepairCompletionListener(
      workflowRepo as unknown as WorkflowRepository,
      eventBus,
    );

    eventBus.on(REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT, (event) =>
      doctorListener.handleDoctorRepairRequested(event as never),
    );
    eventBus.on(REPAIR_DELEGATION_COMPLETED_EVENT, (event) =>
      completionListener.handleRepairDelegationCompleted(event as never),
    );
    eventBus.on(WORKFLOW_RUN_COMPLETED_EVENT, (event) =>
      sysadminCompletionListener.handleWorkflowCompleted(event as never),
    );

    classificationListener = new WorkflowFailureClassificationListener(
      classification as unknown as WorkflowFailureClassificationService,
      dispatchService,
    );
  });

  it('does not emit a repair request when config is disabled even if classification allows repair', async () => {
    settingsEnabled = false;
    classification.classifyRunFailure.mockResolvedValue(
      decision({
        class: 'runtime_artifact_stale',
        allowedRepairActionIds: [
          'doctor.runtime_artifact.refresh_stale_artifacts',
        ],
      }),
    );

    await classificationListener.handleWorkflowRunFailed(
      workflowRunFailedEvent(),
    );
    await eventBus.drain();

    expect(
      eventBus.emitted(REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT),
    ).toHaveLength(0);
    expect(
      eventBus.emitted(REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT),
    ).toHaveLength(0);
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
    expect(stateStore.get(REPAIR_DELEGATION_STATE_KEY)).toBeUndefined();
  });

  it('emits doctor request for stale runtime artifact, completes on doctor success, and retries failed job', async () => {
    classification.classifyRunFailure.mockResolvedValue(
      decision({
        class: 'runtime_artifact_stale',
        reason: 'Runtime artifact is stale.',
        allowedRepairActionIds: [
          'doctor.runtime_artifact.refresh_stale_artifacts',
        ],
      }),
    );
    doctorRepairExecutor.execute.mockResolvedValue({
      attempt_id: 'doctor-attempt-1',
      action_id: 'prune_orphaned_runtime_artifacts',
      status: 'succeeded',
      message: 'Stale runtime artifact refreshed.',
      started_at: '2026-04-29T00:00:00.000Z',
      completed_at: '2026-04-29T00:00:01.000Z',
      logs: [],
    });

    await classificationListener.handleWorkflowRunFailed(
      workflowRunFailedEvent(),
    );
    await eventBus.drain();

    expect(
      eventBus.emitted(REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT),
    ).toHaveLength(1);
    expect(doctorRepairExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action_id: 'prune_orphaned_runtime_artifacts',
        requested_by: 'workflow_repair_delegation',
      }),
    );
    expect(eventBus.emitted(REPAIR_DELEGATION_COMPLETED_EVENT)).toEqual([
      expect.objectContaining({
        workflowRunId,
        policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
        executionPath: 'doctor',
        attempt: 1,
        status: 'succeeded',
        doctorRepairAttemptId: 'doctor-attempt-1',
      }),
    ]);
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).toHaveBeenCalledWith({
      workflowRunId,
      failedJobId,
      retryPrompt:
        'Autonomous repair succeeded for doctor.runtime_artifact.refresh_stale_artifacts\n\nStale runtime artifact refreshed.',
    });
    expect(stateStore.get(REPAIR_DELEGATION_STATE_KEY)).toEqual(
      expect.objectContaining({
        attempts: { 'doctor.runtime_artifact.refresh_stale_artifacts': 1 },
        latest: expect.objectContaining({
          status: 'succeeded',
          policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
          doctorRepairAttemptId: 'doctor-attempt-1',
        }),
      }),
    );
  });

  it('forwards the actual split-coverage violation text to the producer re-dispatch', async () => {
    const violationMessage =
      'Split coverage validation failed for 439b8258: acceptance criteria ' +
      'duplicated across children: AC-1, AC-2';
    classification.classifyRunFailure.mockResolvedValue(
      decision({
        class: 'split_coverage_invalid',
        reason:
          'A producer job emitted output that failed downstream coverage validation.',
        failureMessage: violationMessage,
        allowedRepairActionIds: [
          'doctor.workflow_run.redispatch_producer_with_feedback',
        ],
      }),
    );
    doctorRepairExecutor.execute.mockResolvedValue({
      attempt_id: 'doctor-attempt-1',
      action_id: 'redispatch_producer_job_with_feedback',
      status: 'succeeded',
      message: 'Re-dispatched producer with validation feedback.',
      started_at: '2026-04-29T00:00:00.000Z',
      completed_at: '2026-04-29T00:00:01.000Z',
      logs: [],
    });

    await classificationListener.handleWorkflowRunFailed(
      workflowRunFailedEvent(),
    );
    await eventBus.drain();

    expect(doctorRepairExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: expect.objectContaining({
          validationMessage: violationMessage,
        }),
      }),
    );
  });

  it('falls back to the classifier reason when no failure evidence message is present', async () => {
    classification.classifyRunFailure.mockResolvedValue(
      decision({
        class: 'split_coverage_invalid',
        reason: 'Downstream coverage validation rejected the producer output.',
        allowedRepairActionIds: [
          'doctor.workflow_run.redispatch_producer_with_feedback',
        ],
      }),
    );
    doctorRepairExecutor.execute.mockResolvedValue({
      attempt_id: 'doctor-attempt-1',
      action_id: 'redispatch_producer_job_with_feedback',
      status: 'succeeded',
      message: 'Re-dispatched producer with validation feedback.',
      started_at: '2026-04-29T00:00:00.000Z',
      completed_at: '2026-04-29T00:00:01.000Z',
      logs: [],
    });

    await classificationListener.handleWorkflowRunFailed(
      workflowRunFailedEvent(),
    );
    await eventBus.drain();

    expect(doctorRepairExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: expect.objectContaining({
          validationMessage:
            'Downstream coverage validation rejected the producer output.',
        }),
      }),
    );
  });

  it('emits sysadmin request when dependency is missing', async () => {
    const repairDecision = decision({
      class: 'dependency_missing',
      allowedRepairActionIds: ['repair.dependency.add_declared_package'],
    });
    classification.classifyRunFailure.mockResolvedValue(repairDecision);

    await classificationListener.handleWorkflowRunFailed(
      workflowRunFailedEvent(),
    );
    await eventBus.drain();

    expect(
      eventBus.emitted(REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT),
    ).toEqual([
      expect.objectContaining({
        workflowRunId,
        workflowId,
        failedJobId,
        decision: repairDecision,
        policyActionId: 'repair.dependency.add_declared_package',
        attempt: 1,
      }),
    ]);
    expect(
      eventBus.emitted(REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT),
    ).toHaveLength(0);
  });

  it('completes sysadmin repair workflow and retries failed job after successful repair', async () => {
    classification.classifyRunFailure.mockResolvedValue(
      decision({
        class: 'dependency_missing',
        allowedRepairActionIds: ['repair.dependency.add_declared_package'],
      }),
    );

    await classificationListener.handleWorkflowRunFailed(
      workflowRunFailedEvent(),
    );
    eventBus.emit(
      WORKFLOW_RUN_COMPLETED_EVENT,
      repairWorkflowCompletedEvent({
        trigger: {
          workflowRunId,
          workflowId,
          failedJobId,
          policyActionId: 'repair.dependency.add_declared_package',
          attempt: 1,
        },
      }),
    );
    await eventBus.drain();

    expect(eventBus.emitted(REPAIR_DELEGATION_COMPLETED_EVENT)).toEqual([
      expect.objectContaining({
        workflowRunId,
        workflowId,
        failedJobId,
        policyActionId: 'repair.dependency.add_declared_package',
        executionPath: 'sysadmin_workflow',
        attempt: 1,
        status: 'succeeded',
        message: 'Dependency repair completed.',
        repairWorkflowRunId: 'repair-workflow-run-1',
      }),
    ]);
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).toHaveBeenCalledWith({
      workflowRunId,
      failedJobId,
      retryPrompt:
        'Autonomous repair succeeded for repair.dependency.add_declared_package\n\nDependency repair completed.',
    });
    expect(stateStore.get(REPAIR_DELEGATION_STATE_KEY)).toEqual(
      expect.objectContaining({
        attempts: { 'repair.dependency.add_declared_package': 1 },
        latest: expect.objectContaining({
          status: 'succeeded',
          policyActionId: 'repair.dependency.add_declared_package',
          executionPath: 'sysadmin_workflow',
          repairWorkflowRunId: 'repair-workflow-run-1',
        }),
      }),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: REPAIR_DELEGATION_AUDIT_EVENT,
        outcome: 'success',
        errorCode: 'repair_delegation_succeeded',
        payload: expect.objectContaining({
          status: 'succeeded',
          repairWorkflowRunId: 'repair-workflow-run-1',
        }),
      }),
    );
  });

  it('emits no repair request and records denial audit when credential repair is denied', async () => {
    classification.classifyRunFailure.mockResolvedValue(
      decision({
        class: 'credential_missing',
        eligibility: 'deny',
        reason: 'Credential failures require operator action.',
        allowedRepairActionIds: [],
      }),
    );

    await classificationListener.handleWorkflowRunFailed(
      workflowRunFailedEvent(),
    );
    await eventBus.drain();

    expect(
      eventBus.emitted(REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT),
    ).toHaveLength(0);
    expect(
      eventBus.emitted(REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT),
    ).toHaveLength(0);
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: REPAIR_DELEGATION_AUDIT_EVENT,
        outcome: 'denied',
        severity: 'warn',
        errorCode: 'repair_delegation_denied',
        errorMessage: 'Credential failures require operator action.',
        payload: expect.objectContaining({ status: 'denied' }),
      }),
    );
  });

  it('does not retry failed job when repair completion fails', async () => {
    classification.classifyRunFailure.mockResolvedValue(
      decision({
        class: 'runtime_artifact_stale',
        allowedRepairActionIds: [
          'doctor.runtime_artifact.refresh_stale_artifacts',
        ],
      }),
    );
    doctorRepairExecutor.execute.mockResolvedValue({
      attempt_id: 'doctor-attempt-1',
      action_id: 'prune_orphaned_runtime_artifacts',
      status: 'failed',
      message: 'Doctor repair failed.',
      started_at: '2026-04-29T00:00:00.000Z',
      completed_at: '2026-04-29T00:00:01.000Z',
      logs: [],
    });

    await classificationListener.handleWorkflowRunFailed(
      workflowRunFailedEvent(),
    );
    await eventBus.drain();

    expect(eventBus.emitted(REPAIR_DELEGATION_COMPLETED_EVENT)).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ]);
    expect(
      failedJobRetryService.retryFailedJobWithMessage,
    ).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: REPAIR_DELEGATION_AUDIT_EVENT,
        outcome: 'failure',
        errorCode: 'repair_delegation_failed',
      }),
    );
  });

  it('records retry_limit_exceeded and emits no request when attempt budget is exhausted', async () => {
    maxAttempts = 1;
    stateStore.set(REPAIR_DELEGATION_STATE_KEY, {
      attempts: { 'repair.dependency.add_declared_package': 1 },
    } satisfies WorkflowRepairDelegationState);
    classification.classifyRunFailure.mockResolvedValue(
      decision({
        class: 'dependency_missing',
        allowedRepairActionIds: ['repair.dependency.add_declared_package'],
      }),
    );

    await classificationListener.handleWorkflowRunFailed(
      workflowRunFailedEvent(),
    );
    await eventBus.drain();

    expect(
      eventBus.emitted(REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT),
    ).toHaveLength(0);
    expect(
      eventBus.emitted(REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT),
    ).toHaveLength(0);
    expect(stateStore.get(REPAIR_DELEGATION_STATE_KEY)).toEqual(
      expect.objectContaining({
        attempts: { 'repair.dependency.add_declared_package': 1 },
        latest: expect.objectContaining({
          status: 'retry_limit_exceeded',
          policyActionId: 'repair.dependency.add_declared_package',
          attempt: 1,
        }),
      }),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: REPAIR_DELEGATION_AUDIT_EVENT,
        outcome: 'denied',
        errorCode: 'repair_delegation_retry_limit_exceeded',
        payload: expect.objectContaining({ status: 'retry_limit_exceeded' }),
      }),
    );
  });

  function createSettingsService(): SystemSettingsService {
    return {
      get: vi.fn(async (key: string, defaultValue: unknown) => {
        if (key === WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING) {
          return settingsEnabled;
        }
        if (key === WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING) {
          return maxAttempts;
        }
        return defaultValue;
      }),
    } as unknown as SystemSettingsService;
  }

  function createStateManager(): StateManagerService {
    return {
      getVariable: vi.fn(async (_workflowRunId: string, key: string) =>
        stateStore.get(key),
      ),
      setVariable: vi.fn(
        async (_workflowRunId: string, key: string, value: unknown) => {
          stateStore.set(key, value);
        },
      ),
    } as unknown as StateManagerService;
  }
});

class InMemoryEventBus {
  private readonly handlers = new Map<
    string,
    Array<(event: unknown) => unknown>
  >();
  private readonly events = new Map<string, unknown[]>();
  private pending: Promise<unknown>[] = [];

  on(eventName: string, handler: (event: unknown) => unknown): void {
    this.handlers.set(eventName, [
      ...(this.handlers.get(eventName) ?? []),
      handler,
    ]);
  }

  emit(eventName: string, event: unknown): boolean {
    this.events.set(eventName, [...(this.events.get(eventName) ?? []), event]);

    for (const handler of this.handlers.get(eventName) ?? []) {
      this.pending.push(Promise.resolve(handler(event)));
    }

    return true;
  }

  emitted(eventName: string): unknown[] {
    return this.events.get(eventName) ?? [];
  }

  async drain(): Promise<void> {
    while (this.pending.length > 0) {
      const pending = this.pending;
      this.pending = [];
      await Promise.all(pending);
    }
  }
}

function workflowRunFailedEvent(): WorkflowRunEvent {
  return {
    workflowRunId: 'workflow-run-1',
    workflowId: 'workflow-1',
    status: 'FAILED',
    stateVariables: {
      current_step_id: 'failed-job-1',
    },
  };
}

function repairWorkflowCompletedEvent(params: {
  trigger: Record<string, unknown>;
}): WorkflowRunEvent {
  return {
    workflowRunId: 'repair-workflow-run-1',
    workflowId: 'environment-repair-workflow-id',
    status: 'COMPLETED',
    stateVariables: {
      trigger: params.trigger,
      jobs: {
        repair_environment: {
          output: {
            status: 'succeeded',
            summary: 'Dependency repair completed.',
          },
        },
      },
    },
  };
}

function decision(
  overrides: Partial<FailureClassificationDecision> = {},
): FailureClassificationDecision {
  return {
    class: 'dependency_missing',
    confidence: 0.9,
    reason: 'Package missing from local environment.',
    evidenceReferences: [],
    eligibility: 'allow',
    allowedRepairActionIds: ['repair.dependency.add_declared_package'],
    ...overrides,
  };
}
