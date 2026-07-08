import { EventEmitter2 } from '@nestjs/event-emitter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import {
  WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING,
  WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING,
} from '../../settings/repair-delegation-settings.constants';
import { StateManagerService } from '../state-manager.service';
import type { FailureClassificationDecision } from './failure-classification.types';
import {
  REPAIR_DELEGATION_AUDIT_EVENT,
  REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT,
  REPAIR_DELEGATION_STATE_KEY,
  REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT,
  type WorkflowRepairDelegationState,
} from './repair-delegation.types';
import { RepairExecutorRegistryService } from './repair-executor-registry.service';
import { WorkflowRepairDispatchService } from './workflow-repair-dispatch.service';

describe('WorkflowRepairDispatchService', () => {
  const settings = {
    get: vi.fn(),
  };
  const stateManager = {
    getVariable: vi.fn(),
    setVariable: vi.fn(),
  };
  const eventLedger = {
    emitBestEffort: vi.fn(),
  };
  const eventEmitter = {
    emit: vi.fn(),
  };
  const repairExecutorRegistry = {
    resolveExecutionPlan: vi.fn(),
  };

  let service: WorkflowRepairDispatchService;

  beforeEach(() => {
    vi.clearAllMocks();
    settings.get.mockImplementation((key: string, defaultValue: unknown) => {
      if (key === WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING) return true;
      if (key === WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING) return 1;
      return defaultValue;
    });
    stateManager.getVariable.mockResolvedValue(undefined);
    stateManager.setVariable.mockResolvedValue(undefined);
    eventLedger.emitBestEffort.mockResolvedValue(undefined);
    repairExecutorRegistry.resolveExecutionPlan.mockImplementation(
      (policyActionId: string) => {
        if (
          policyActionId === 'doctor.runtime_artifact.refresh_stale_artifacts'
        ) {
          return {
            path: 'doctor',
            policyActionId,
            concreteActionId: 'prune_orphaned_runtime_artifacts',
          };
        }
        if (policyActionId === 'repair.dependency.add_declared_package') {
          return { path: 'sysadmin_workflow', policyActionId };
        }
        return null;
      },
    );
    service = new WorkflowRepairDispatchService(
      settings as unknown as SystemSettingsService,
      stateManager as unknown as StateManagerService,
      eventLedger as unknown as EventLedgerService,
      eventEmitter,
      repairExecutorRegistry,
    );
  });

  it('does not dispatch when config disabled', async () => {
    settings.get.mockImplementation((key: string, defaultValue: unknown) => {
      if (key === WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING) return false;
      return defaultValue;
    });

    await expect(service.dispatchIfAllowed(baseDispatch())).resolves.toBe(
      false,
    );

    expect(settings.get).toHaveBeenCalledWith(
      WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING,
      false,
    );
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
    expect(stateManager.setVariable).not.toHaveBeenCalled();
  });

  it('does not dispatch and audits when decision eligibility is not allow', async () => {
    const decision = baseDecision({ eligibility: 'deny' });

    await expect(
      service.dispatchIfAllowed(baseDispatch({ decision })),
    ).resolves.toBe(false);

    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: REPAIR_DELEGATION_AUDIT_EVENT,
        outcome: 'denied',
        payload: expect.objectContaining({ status: 'denied' }),
      }),
    );
  });

  it('redacts session tree summaries from repair delegation audits', async () => {
    const decision = baseDecision({
      eligibility: 'deny',
      evidenceReferences: [
        {
          kind: 'session_tree',
          id: 'session-tree-1',
          summary: 'Raw transcript with secret token abc123.',
        },
      ],
    });

    await expect(
      service.dispatchIfAllowed(baseDispatch({ decision })),
    ).resolves.toBe(false);

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          decision: expect.objectContaining({
            evidenceReferences: [
              {
                kind: 'session_tree',
                id: 'session-tree-1',
                summary: 'Session transcript failure reference captured.',
              },
            ],
          }),
        }),
      }),
    );
  });

  it('sanitizes secret-bearing decision reasons in denied audit error messages', async () => {
    const decision = baseDecision({
      eligibility: 'deny',
      reason:
        'Classifier saw token sk-live-secret and authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature.',
    });

    await expect(
      service.dispatchIfAllowed(baseDispatch({ decision })),
    ).resolves.toBe(false);

    const auditEvent = eventLedger.emitBestEffort.mock.calls[0]?.[0];

    expect(auditEvent.errorMessage).toContain('[REDACTED]');
    expect(auditEvent.errorMessage).not.toContain('sk-live-secret');
    expect(auditEvent.errorMessage).not.toContain('payload.signature');
  });

  it('does not dispatch and audits when allowed action ID is unknown', async () => {
    repairExecutorRegistry.resolveExecutionPlan.mockReturnValue(null);
    const decision = baseDecision({
      allowedRepairActionIds: ['repair.unknown.action'],
    });

    await expect(
      service.dispatchIfAllowed(baseDispatch({ decision })),
    ).resolves.toBe(false);

    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: REPAIR_DELEGATION_AUDIT_EVENT,
        outcome: 'denied',
        payload: expect.objectContaining({ status: 'denied' }),
      }),
    );
  });

  it('resolves allowed actions through the executor registry', async () => {
    repairExecutorRegistry.resolveExecutionPlan.mockReturnValue({
      path: 'sysadmin_workflow',
      policyActionId: 'repair.dependency.add_declared_package',
    });

    await expect(service.dispatchIfAllowed(baseDispatch())).resolves.toBe(true);

    expect(repairExecutorRegistry.resolveExecutionPlan).toHaveBeenCalledWith(
      'repair.dependency.add_declared_package',
    );
  });

  it('does not dispatch and audits retry_limit_exceeded when attempt count reaches max', async () => {
    const existingState: WorkflowRepairDelegationState = {
      attempts: {
        'repair.dependency.add_declared_package': 1,
      },
    };
    stateManager.getVariable.mockResolvedValue(existingState);

    await expect(service.dispatchIfAllowed(baseDispatch())).resolves.toBe(
      false,
    );

    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(stateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      REPAIR_DELEGATION_STATE_KEY,
      expect.objectContaining({
        attempts: existingState.attempts,
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
        payload: expect.objectContaining({ status: 'retry_limit_exceeded' }),
      }),
    );
  });

  it('emits doctor requested event for runtime artifact stale repair', async () => {
    const decision = baseDecision({
      class: 'runtime_artifact_stale',
      allowedRepairActionIds: [
        'doctor.runtime_artifact.refresh_stale_artifacts',
      ],
    });

    await expect(
      service.dispatchIfAllowed(baseDispatch({ decision })),
    ).resolves.toBe(true);

    expect(stateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      REPAIR_DELEGATION_STATE_KEY,
      expect.objectContaining({
        attempts: { 'doctor.runtime_artifact.refresh_stale_artifacts': 1 },
        latest: expect.objectContaining({
          status: 'dispatched',
          policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
          executionPath: 'doctor',
          concreteActionId: 'prune_orphaned_runtime_artifacts',
          attempt: 1,
        }),
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT,
      expect.objectContaining({
        workflowRunId: 'run-1',
        workflowId: 'workflow-1',
        failedJobId: 'job-1',
        decision,
        policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
        concreteActionId: 'prune_orphaned_runtime_artifacts',
        attempt: 1,
      }),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT,
        outcome: 'success',
        severity: 'info',
        payload: expect.objectContaining({
          status: 'dispatched',
          decision,
          policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
          executionPath: 'doctor',
          concreteActionId: 'prune_orphaned_runtime_artifacts',
          attempt: 1,
          failedJobId: 'job-1',
        }),
      }),
    );
  });

  it('emits sanitized decision in repair request events', async () => {
    const rawReason =
      'Allowed after token is abc.def.ghi and authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature.';
    const decision = baseDecision({
      reason: rawReason,
      evidenceReferences: [
        {
          kind: 'session_tree',
          id: 'session-tree-1',
          summary: 'Raw transcript with secret token abc123.',
        },
      ],
    });

    await expect(
      service.dispatchIfAllowed(baseDispatch({ decision })),
    ).resolves.toBe(true);

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT,
      expect.objectContaining({
        decision: expect.objectContaining({
          reason: expect.stringContaining('[REDACTED]'),
          class: decision.class,
          confidence: decision.confidence,
          eligibility: decision.eligibility,
          allowedRepairActionIds: decision.allowedRepairActionIds,
          evidenceReferences: [
            {
              kind: 'session_tree',
              id: 'session-tree-1',
              summary: 'Session transcript failure reference captured.',
            },
          ],
        }),
      }),
    );

    const emittedRequestPayload = JSON.stringify(
      eventEmitter.emit.mock.calls[0]?.[1],
    );

    expect(emittedRequestPayload).not.toContain(rawReason);
    expect(emittedRequestPayload).not.toContain('abc.def.ghi');
    expect(emittedRequestPayload).not.toContain('payload.signature');
  });

  it('sanitizes secret-bearing decision reasons in dispatched audit and requested lifecycle payloads', async () => {
    const rawReason =
      'Allowed because apiKey=pk-live-secret.with.suffix, credential: rk-live-secret, authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature.';
    const decision = baseDecision({
      reason: rawReason,
    });

    await expect(
      service.dispatchIfAllowed(baseDispatch({ decision })),
    ).resolves.toBe(true);

    const genericAuditEvent = eventLedger.emitBestEffort.mock.calls[0]?.[0];
    const lifecycleEvent = eventLedger.emitBestEffort.mock.calls[1]?.[0];

    expect(genericAuditEvent.errorMessage).toContain('[REDACTED]');
    expect(lifecycleEvent.errorMessage).toContain('[REDACTED]');
    for (const event of [genericAuditEvent, lifecycleEvent]) {
      const serializedEvent = JSON.stringify(event);

      expect(event.errorMessage).not.toContain('pk-live-secret.with.suffix');
      expect(event.errorMessage).not.toContain('rk-live-secret');
      expect(event.errorMessage).not.toContain('payload.signature');
      expect(event.payload.decision).toEqual(
        expect.objectContaining({
          reason: expect.stringContaining('[REDACTED]'),
          class: decision.class,
          confidence: decision.confidence,
          eligibility: decision.eligibility,
          allowedRepairActionIds: decision.allowedRepairActionIds,
        }),
      );
      expect(serializedEvent).not.toContain(rawReason);
      expect(serializedEvent).not.toContain('pk-live-secret.with.suffix');
      expect(serializedEvent).not.toContain('payload.signature');
    }
  });

  it('allows only one concurrent dispatch per run and action when max attempts is one', async () => {
    let storedState: WorkflowRepairDelegationState | undefined;
    stateManager.getVariable.mockImplementation(() => storedState);
    stateManager.setVariable.mockImplementation(
      async (
        _workflowRunId: string,
        _key: string,
        state: WorkflowRepairDelegationState,
      ) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        storedState = state;
      },
    );

    const [firstResult, secondResult] = await Promise.all([
      service.dispatchIfAllowed(baseDispatch()),
      service.dispatchIfAllowed(baseDispatch()),
    ]);

    expect([firstResult, secondResult].filter(Boolean)).toHaveLength(1);
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('emits sysadmin requested event for dependency/local config repair', async () => {
    await expect(service.dispatchIfAllowed(baseDispatch())).resolves.toBe(true);

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT,
      expect.objectContaining({
        workflowRunId: 'run-1',
        workflowId: 'workflow-1',
        failedJobId: 'job-1',
        decision: baseDecision(),
        policyActionId: 'repair.dependency.add_declared_package',
        attempt: 1,
      }),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT,
        outcome: 'success',
        severity: 'info',
        payload: expect.objectContaining({
          status: 'dispatched',
          decision: baseDecision(),
          policyActionId: 'repair.dependency.add_declared_package',
          executionPath: 'sysadmin_workflow',
          concreteActionId: undefined,
          attempt: 1,
          failedJobId: 'job-1',
        }),
      }),
    );
  });
});

function baseDispatch(
  overrides?: Partial<{
    workflowRunId: string;
    workflowId: string;
    failedJobId: string;
    decision: FailureClassificationDecision;
  }>,
) {
  return {
    workflowRunId: 'run-1',
    workflowId: 'workflow-1',
    failedJobId: 'job-1',
    decision: baseDecision(),
    ...overrides,
  };
}

function baseDecision(
  overrides?: Partial<FailureClassificationDecision>,
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
