import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { RuntimeFeedbackSignal } from '@nexus/core';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { RuntimeFeedbackIngestionService } from '../../runtime-feedback/runtime-feedback-ingestion.service';
import { StateManagerService } from '../state-manager.service';
import { WorkflowFailedJobRetryService } from '../workflow-failed-job-retry.service';
import {
  REPAIR_DELEGATION_AUDIT_EVENT,
  REPAIR_DELEGATION_COMPLETED_EVENT,
  REPAIR_DELEGATION_STATE_KEY,
  type RepairDelegationCompletedEvent,
  type WorkflowRepairDelegationState,
} from './repair-delegation.types';
import { sanitizeCompletionMessage } from './completion-message-sanitizer';

const MAX_RUNTIME_FEEDBACK_EXAMPLE_SUMMARY_LENGTH = 500;
const TRUNCATED_RUNTIME_FEEDBACK_EXAMPLE_SUFFIX = '... [truncated]';

@Injectable()
export class WorkflowRepairCompletionListener {
  private readonly logger = new Logger(WorkflowRepairCompletionListener.name);
  private readonly completionLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly stateManager: StateManagerService,
    private readonly eventLedger: EventLedgerService,
    private readonly failedJobRetryService: WorkflowFailedJobRetryService,
    private readonly runtimeFeedback: RuntimeFeedbackIngestionService,
  ) {}

  @OnEvent(REPAIR_DELEGATION_COMPLETED_EVENT)
  async handleRepairDelegationCompleted(
    event: RepairDelegationCompletedEvent,
  ): Promise<void> {
    await this.withCompletionLock(this.lockKey(event), () =>
      this.processRepairDelegationCompleted(event),
    );
  }

  private async processRepairDelegationCompleted(
    event: RepairDelegationCompletedEvent,
  ): Promise<void> {
    try {
      const state = await this.loadRepairDelegationState(event.workflowRunId);
      if (this.isStaleCompletion(event, state)) {
        return;
      }

      const sanitizedMessage = sanitizeCompletionMessage(event.message);

      if (this.shouldRetryFailedJob(event, state)) {
        await this.retryFailedJob(event, sanitizedMessage);
      }

      await this.recordCompletion(event, state, sanitizedMessage);
      await this.auditCompletion(event, sanitizedMessage);
      await this.auditLifecycleCompletion(event, sanitizedMessage);
      await this.ingestRuntimeFeedbackBestEffort(event, sanitizedMessage);
    } catch (error) {
      this.logger.warn(
        `Failed to process repair delegation completion for run ${event.workflowRunId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async withCompletionLock<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.completionLocks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.completionLocks.set(key, next);

    try {
      return await next;
    } finally {
      if (this.completionLocks.get(key) === next) {
        this.completionLocks.delete(key);
      }
    }
  }

  private lockKey(event: RepairDelegationCompletedEvent): string {
    return `${event.workflowRunId}:${event.policyActionId}`;
  }

  private async recordCompletion(
    event: RepairDelegationCompletedEvent,
    state: WorkflowRepairDelegationState,
    sanitizedMessage: string,
  ): Promise<void> {
    const existingAttempt = state.attempts[event.policyActionId] ?? 0;
    const attempt = Math.max(existingAttempt, event.attempt);

    await this.stateManager.setVariable(
      event.workflowRunId,
      REPAIR_DELEGATION_STATE_KEY,
      {
        attempts: {
          ...state.attempts,
          [event.policyActionId]: attempt,
        },
        latest: {
          status: event.status,
          policyActionId: event.policyActionId,
          executionPath: event.executionPath,
          attempt,
          failedJobId: event.failedJobId,
          repairWorkflowRunId: event.repairWorkflowRunId,
          doctorRepairAttemptId: event.doctorRepairAttemptId,
          message: sanitizedMessage,
          recordedAt: new Date().toISOString(),
        },
      } satisfies WorkflowRepairDelegationState,
    );
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

  private async auditCompletion(
    event: RepairDelegationCompletedEvent,
    sanitizedMessage: string,
  ): Promise<void> {
    await this.eventLedger.emitBestEffort({
      domain: 'workflow',
      eventName: REPAIR_DELEGATION_AUDIT_EVENT,
      workflowRunId: event.workflowRunId,
      workflowId: event.workflowId,
      jobId: event.failedJobId,
      outcome: event.status === 'succeeded' ? 'success' : 'failure',
      severity: event.status === 'succeeded' ? 'info' : 'warn',
      errorCode: `repair_delegation_${event.status}`,
      errorMessage: sanitizedMessage,
      payload: {
        status: event.status,
        policyActionId: event.policyActionId,
        executionPath: event.executionPath,
        attempt: event.attempt,
        failedJobId: event.failedJobId,
        repairWorkflowRunId: event.repairWorkflowRunId,
        doctorRepairAttemptId: event.doctorRepairAttemptId,
      },
    });
  }

  private async auditLifecycleCompletion(
    event: RepairDelegationCompletedEvent,
    sanitizedMessage: string,
  ): Promise<void> {
    await this.eventLedger.emitBestEffort({
      domain: 'workflow',
      eventName: REPAIR_DELEGATION_COMPLETED_EVENT,
      workflowRunId: event.workflowRunId,
      workflowId: event.workflowId,
      jobId: event.failedJobId,
      outcome: event.status === 'succeeded' ? 'success' : 'failure',
      severity: event.status === 'succeeded' ? 'info' : 'warn',
      errorCode: `repair_delegation_${event.status}`,
      errorMessage: sanitizedMessage,
      payload: {
        status: event.status,
        policyActionId: event.policyActionId,
        executionPath: event.executionPath,
        attempt: event.attempt,
        failedJobId: event.failedJobId,
        repairWorkflowRunId: event.repairWorkflowRunId,
        doctorRepairAttemptId: event.doctorRepairAttemptId,
      },
    });
  }

  private async retryFailedJob(
    event: RepairDelegationCompletedEvent,
    sanitizedMessage: string,
  ): Promise<void> {
    await this.failedJobRetryService.retryFailedJobWithMessage({
      workflowRunId: event.workflowRunId,
      failedJobId: event.failedJobId,
      retryPrompt: `Autonomous repair succeeded for ${event.policyActionId}\n\n${sanitizedMessage}`,
    });
  }

  private async ingestRuntimeFeedbackBestEffort(
    event: RepairDelegationCompletedEvent,
    sanitizedMessage: string,
  ): Promise<void> {
    await this.runtimeFeedback
      .ingest(this.buildRuntimeFeedbackSignal(event, sanitizedMessage))
      .catch(() => undefined);
  }

  private buildRuntimeFeedbackSignal(
    event: RepairDelegationCompletedEvent,
    sanitizedMessage: string,
  ): RuntimeFeedbackSignal {
    return {
      signal_type: 'repair_outcome',
      source_module: 'workflow-repair',
      scope: {
        scope_type: 'workflow',
        scope_id: event.workflowId,
      },
      affected: {
        workflow_id: event.workflowId,
        workflow_run_id: event.workflowRunId,
        job_id: event.failedJobId,
        schema_path: event.executionPath,
        repair_action_id: event.policyActionId,
      },
      evidence: [
        {
          kind: 'repair_outcome',
          id: event.failedJobId,
          summary: `Repair action ${event.policyActionId} ${event.status} for path ${event.executionPath}.`,
        },
      ],
      examples: [
        {
          summary: this.buildSafeRuntimeFeedbackExample(sanitizedMessage),
          redacted: true,
        },
      ],
      confidence: event.status === 'succeeded' ? 0.9 : 0.75,
      severity: event.status === 'succeeded' ? 'low' : 'medium',
      dedupe_fingerprint: this.buildRuntimeFeedbackDedupeFingerprint(event),
      occurred_at: new Date().toISOString(),
    };
  }

  private buildSafeRuntimeFeedbackExample(sanitizedMessage: string): string {
    const safeMessage = sanitizedMessage
      .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
      .replace(
        /\btool payload body:\s*\{[^}]*\}/gi,
        'tool payload reference redacted',
      );

    const exampleSummary = `Sanitized completion message: ${safeMessage}`;
    if (exampleSummary.length <= MAX_RUNTIME_FEEDBACK_EXAMPLE_SUMMARY_LENGTH) {
      return exampleSummary;
    }

    return `${exampleSummary.slice(
      0,
      MAX_RUNTIME_FEEDBACK_EXAMPLE_SUMMARY_LENGTH -
        TRUNCATED_RUNTIME_FEEDBACK_EXAMPLE_SUFFIX.length,
    )}${TRUNCATED_RUNTIME_FEEDBACK_EXAMPLE_SUFFIX}`;
  }

  private buildRuntimeFeedbackDedupeFingerprint(
    event: RepairDelegationCompletedEvent,
  ): string {
    return [
      'repair_outcome',
      `policy:${event.policyActionId}`,
      `path:${event.executionPath}`,
      `workflow:${event.workflowId}`,
      `job:${event.failedJobId ?? 'none'}`,
      `status:${event.status}`,
    ].join('|');
  }

  private isStaleCompletion(
    event: RepairDelegationCompletedEvent,
    state: WorkflowRepairDelegationState,
  ): boolean {
    if (state.latest && state.latest.policyActionId !== event.policyActionId) {
      return true;
    }

    if ((state.attempts[event.policyActionId] ?? 0) > event.attempt) {
      return true;
    }

    return Boolean(
      state.latest &&
      state.latest.policyActionId === event.policyActionId &&
      state.latest.attempt === event.attempt &&
      isTerminalRepairStatus(state.latest.status),
    );
  }

  private shouldRetryFailedJob(
    event: RepairDelegationCompletedEvent,
    state: WorkflowRepairDelegationState,
  ): boolean {
    return Boolean(
      event.status === 'succeeded' &&
      event.failedJobId &&
      state.latest?.status === 'dispatched' &&
      state.latest.policyActionId === event.policyActionId &&
      state.latest.attempt === event.attempt,
    );
  }
}

function isTerminalRepairStatus(status: string): boolean {
  return status === 'succeeded' || status === 'failed';
}
