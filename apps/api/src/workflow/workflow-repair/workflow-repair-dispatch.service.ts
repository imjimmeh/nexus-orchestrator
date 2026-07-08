import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import {
  WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING,
  WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING,
} from '../../settings/repair-delegation-settings.constants';
import { StateManagerService } from '../state-manager.service';
import type { FailureClassificationDecision } from './failure-classification.types';
import { sanitizeCompletionMessage } from './completion-message-sanitizer';
import {
  REPAIR_DELEGATION_AUDIT_EVENT,
  REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT,
  REPAIR_DELEGATION_STATE_KEY,
  REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT,
  type RepairDelegationStatus,
  type RepairExecutionPlan,
  type WorkflowRepairDelegationState,
} from './repair-delegation.types';
import { RepairExecutorRegistryService } from './repair-executor-registry.service';

interface DispatchIfAllowedParams {
  workflowRunId: string;
  workflowId: string;
  failedJobId?: string;
  decision: FailureClassificationDecision;
}

@Injectable()
export class WorkflowRepairDispatchService {
  private readonly dispatchLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly settings: SystemSettingsService,
    private readonly stateManager: StateManagerService,
    private readonly eventLedger: EventLedgerService,
    private readonly eventEmitter: EventEmitter2,
    private readonly repairExecutorRegistry: RepairExecutorRegistryService,
  ) {}

  async dispatchIfAllowed(params: DispatchIfAllowedParams): Promise<boolean> {
    const enabled = await this.settings.get(
      WORKFLOW_REPAIR_DELEGATION_ENABLED_SETTING,
      false,
    );
    if (!enabled) {
      return false;
    }

    if (params.decision.eligibility !== 'allow') {
      await this.auditDecision(params, 'denied');
      return false;
    }

    const plan = this.resolveFirstPlan(params.decision.allowedRepairActionIds);
    if (!plan) {
      await this.auditDecision(params, 'denied');
      return false;
    }

    return this.withDispatchLock(
      this.lockKey(params.workflowRunId, plan.policyActionId),
      () => this.dispatchResolvedPlan(params, plan),
    );
  }

  private async dispatchResolvedPlan(
    params: DispatchIfAllowedParams,
    plan: RepairExecutionPlan,
  ): Promise<boolean> {
    const state = await this.loadRepairDelegationState(params.workflowRunId);
    const maxAttempts = await this.settings.get(
      WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING,
      1,
    );
    const currentAttempts = state.attempts[plan.policyActionId] ?? 0;

    if (currentAttempts >= maxAttempts) {
      const exhaustedState = this.withLatestState({
        state,
        params,
        plan,
        status: 'retry_limit_exceeded',
        attempt: currentAttempts,
      });
      await this.stateManager.setVariable(
        params.workflowRunId,
        REPAIR_DELEGATION_STATE_KEY,
        exhaustedState,
      );
      await this.auditDecision(params, 'retry_limit_exceeded', plan);
      return false;
    }

    const attempt = currentAttempts + 1;
    const dispatchedState = this.withLatestState({
      state: {
        ...state,
        attempts: { ...state.attempts, [plan.policyActionId]: attempt },
      },
      params,
      plan,
      status: 'dispatched',
      attempt,
    });
    await this.stateManager.setVariable(
      params.workflowRunId,
      REPAIR_DELEGATION_STATE_KEY,
      dispatchedState,
    );

    await this.auditDecision(params, 'dispatched', plan, attempt);
    await this.auditRequested(params, plan, attempt);
    this.eventEmitter.emit(this.eventNameForPlan(plan), {
      workflowRunId: params.workflowRunId,
      workflowId: params.workflowId,
      failedJobId: params.failedJobId,
      decision: sanitizeDecision(params.decision),
      failureMessage: resolveFailureMessage(params.decision),
      policyActionId: plan.policyActionId,
      concreteActionId: plan.concreteActionId,
      attempt,
    });

    return true;
  }

  private async withDispatchLock<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.dispatchLocks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.dispatchLocks.set(key, next);

    try {
      return await next;
    } finally {
      if (this.dispatchLocks.get(key) === next) {
        this.dispatchLocks.delete(key);
      }
    }
  }

  private lockKey(workflowRunId: string, policyActionId: string): string {
    return `${workflowRunId}:${policyActionId}`;
  }

  private resolveFirstPlan(actionIds: string[]): RepairExecutionPlan | null {
    for (const actionId of actionIds) {
      const plan = this.repairExecutorRegistry.resolveExecutionPlan(actionId);
      if (plan) {
        return plan;
      }
    }
    return null;
  }

  private async loadRepairDelegationState(
    workflowRunId: string,
  ): Promise<WorkflowRepairDelegationState> {
    const stored = await this.stateManager.getVariable(
      workflowRunId,
      REPAIR_DELEGATION_STATE_KEY,
    );
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return { attempts: {} };
    }

    const attempts = (stored as WorkflowRepairDelegationState).attempts;
    if (!attempts || typeof attempts !== 'object' || Array.isArray(attempts)) {
      return { attempts: {} };
    }

    return stored as WorkflowRepairDelegationState;
  }

  private withLatestState(params: {
    state: WorkflowRepairDelegationState;
    params: DispatchIfAllowedParams;
    plan: RepairExecutionPlan;
    status: RepairDelegationStatus;
    attempt: number;
  }): WorkflowRepairDelegationState {
    return {
      attempts: params.state.attempts,
      latest: {
        status: params.status,
        policyActionId: params.plan.policyActionId,
        executionPath: params.plan.path,
        concreteActionId: params.plan.concreteActionId,
        attempt: params.attempt,
        failedJobId: params.params.failedJobId,
        recordedAt: new Date().toISOString(),
      },
    };
  }

  private eventNameForPlan(plan: RepairExecutionPlan): string {
    return plan.path === 'doctor'
      ? REPAIR_DELEGATION_DOCTOR_REQUESTED_EVENT
      : REPAIR_DELEGATION_SYSADMIN_REQUESTED_EVENT;
  }

  private async auditDecision(
    params: DispatchIfAllowedParams,
    status: RepairDelegationStatus,
    plan?: RepairExecutionPlan,
    attempt?: number,
  ): Promise<void> {
    const safeReason = sanitizeCompletionMessage(params.decision.reason);

    await this.eventLedger.emitBestEffort({
      domain: 'workflow',
      eventName: REPAIR_DELEGATION_AUDIT_EVENT,
      workflowRunId: params.workflowRunId,
      workflowId: params.workflowId,
      jobId: params.failedJobId,
      outcome: status === 'dispatched' ? 'success' : 'denied',
      severity: status === 'dispatched' ? 'info' : 'warn',
      errorCode: `repair_delegation_${status}`,
      errorMessage: safeReason,
      payload: {
        status,
        decision: sanitizeDecision(params.decision),
        policyActionId: plan?.policyActionId,
        executionPath: plan?.path,
        concreteActionId: plan?.concreteActionId,
        attempt,
      },
    });
  }

  private async auditRequested(
    params: DispatchIfAllowedParams,
    plan: RepairExecutionPlan,
    attempt: number,
  ): Promise<void> {
    const safeReason = sanitizeCompletionMessage(params.decision.reason);

    await this.eventLedger.emitBestEffort({
      domain: 'workflow',
      eventName: this.eventNameForPlan(plan),
      workflowRunId: params.workflowRunId,
      workflowId: params.workflowId,
      jobId: params.failedJobId,
      outcome: 'success',
      severity: 'info',
      errorCode: 'repair_delegation_dispatched',
      errorMessage: safeReason,
      payload: {
        status: 'dispatched',
        decision: sanitizeDecision(params.decision),
        policyActionId: plan.policyActionId,
        executionPath: plan.path,
        concreteActionId: plan.concreteActionId,
        attempt,
        failedJobId: params.failedJobId,
      },
    });
  }
}

function resolveFailureMessage(
  decision: FailureClassificationDecision,
): string | undefined {
  const message = decision.failureMessage?.trim();
  return message ? sanitizeCompletionMessage(message) : undefined;
}

function sanitizeDecision(
  decision: FailureClassificationDecision,
): FailureClassificationDecision {
  return {
    ...decision,
    reason: sanitizeCompletionMessage(decision.reason),
    evidenceReferences: decision.evidenceReferences.map((reference) => ({
      kind: reference.kind,
      id: reference.id,
      summary:
        reference.kind === 'session_tree'
          ? 'Session transcript failure reference captured.'
          : reference.summary,
    })),
  };
}
