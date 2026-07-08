import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { DomainEventEnvelope } from '../../domain-events/domain-event-bus.types';
import { InProcessDomainEventBus } from '../../domain-events/in-process-domain-event.bus';
import { LOCAL_DOMAIN_EVENT_FANOUT } from '../../domain-events/outbox-domain-event.bus';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import { EXECUTION_EVENT_TYPES } from '../../execution-lifecycle/execution-lifecycle.contracts';
import type { ExecutionState } from '../../execution-lifecycle/execution-lifecycle.contracts';
import { WorkflowRunJobExecutionService } from '../workflow-run-job-execution.service';
import { StepEventPublisherService } from './step-event-publisher.service';
import {
  WORKFLOW_ENGINE_SERVICE,
  type IWorkflowEngineService,
} from '../kernel/interfaces/workflow-kernel.ports';
import { InterruptionRecoveryService } from '../workflow-interruption-recovery/interruption-recovery.service';
import type { InterruptionRecoveryResult } from '../workflow-interruption-recovery/interruption-recovery.types';

/**
 * Listens for execution.completed / execution.failed domain events and routes
 * them back into the workflow engine for workflow_step executions.
 *
 * This is the completion side of the fire-and-poll dispatch introduced in
 * Phase 3.  The BullMQ consumer fires a dispatch and returns immediately;
 * step lifecycle (handleJobComplete / handleJobFailed) now arrives here via
 * the domain event bus rather than blocking the consumer.
 */
@Injectable()
export class StepExecutionCompletionListener implements OnModuleInit {
  private readonly logger = new Logger(StepExecutionCompletionListener.name);

  constructor(
    @Inject(LOCAL_DOMAIN_EVENT_FANOUT)
    private readonly bus: InProcessDomainEventBus,
    private readonly executionRepo: ExecutionRepository,
    private readonly runJobExecution: WorkflowRunJobExecutionService,
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    private readonly stepEventPublisher: StepEventPublisherService,
    private readonly interruptionRecovery: InterruptionRecoveryService,
  ) {}

  onModuleInit(): void {
    this.bus.on(EXECUTION_EVENT_TYPES.completed, (e) =>
      this.onExecutionCompleted(e),
    );
    this.bus.on(EXECUTION_EVENT_TYPES.failed, (e) => this.onExecutionFailed(e));
    this.bus.on(EXECUTION_EVENT_TYPES.reaped, (e) => this.onExecutionFailed(e));
  }

  private async onExecutionCompleted(
    event: DomainEventEnvelope,
  ): Promise<void> {
    try {
      const context = await this.resolveWorkflowStepContext(event.aggregateId);
      if (!context) {
        return;
      }

      if (this.isSupersededExecution(context.state)) {
        this.logger.log(
          `Ignoring completion of superseded execution ${event.aggregateId} for job ${context.jobId} in run ${context.workflowRunId}`,
        );
        return;
      }

      // Idempotency guard: two paths can emit execution.completed for the same
      // step — the in-process awaiter and the telemetry StepCompletionFinalizer.
      // If they race such that the projector advances the row to a terminal
      // state (completed/failed/reaped) before the second event arrives, that
      // second event must be a no-op. Only running/completing are legitimate
      // pre-completion states; anything else means the job was already advanced.
      if (!this.isAdvanceableExecution(context.state)) {
        this.logger.log(
          `Ignoring completion of already-terminal execution ${event.aggregateId} (state=${context.state})`,
        );
        return;
      }

      const { workflowRunId, jobId } = context;
      this.logger.log(
        `Execution ${event.aggregateId} completed — advancing workflow run ${workflowRunId} job ${jobId}`,
      );

      await this.workflowEngine.handleJobComplete(workflowRunId, jobId, {
        executionId: event.aggregateId,
        ok: true,
      });
    } catch (error) {
      this.logger.error(
        `Failed to handle execution.completed for ${event.aggregateId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private async onExecutionFailed(event: DomainEventEnvelope): Promise<void> {
    try {
      const context = await this.resolveWorkflowStepContext(event.aggregateId);
      if (!context) {
        return;
      }

      // A cancelled execution was deliberately superseded by a newer attempt
      // for the same (run, job): its container is expected to die when the new
      // attempt cleans it up. Treating that death as a fresh job failure
      // double-counts auto-retry attempts and can exhaust them while the live
      // attempt is healthy.
      if (this.isSupersededExecution(context.state)) {
        this.logger.log(
          `Ignoring failure of superseded execution ${event.aggregateId} for job ${context.jobId} in run ${context.workflowRunId}`,
        );
        return;
      }

      const { workflowRunId, jobId } = context;
      let parentResume: InterruptionRecoveryResult['parentResume'];

      // Fix C: If a reaped event arrives for a job that already has a completed
      // execution, skip the retry. This prevents duplicate containers when the
      // supervisor idle-timeout fires on a stale execution entity after the job
      // already succeeded (e.g. applyTransition race or BullMQ consumer retry).
      if (event.eventType === EXECUTION_EVENT_TYPES.reaped) {
        const siblings = await this.executionRepo.findByWorkflowRunAndJob(
          workflowRunId,
          jobId,
        );
        const alreadyCompleted = siblings.some((e) => e.state === 'completed');
        if (alreadyCompleted) {
          this.logger.warn(
            `Skipping retry for reaped execution ${event.aggregateId}: job ${jobId} in run ${workflowRunId} already has a completed execution`,
          );
          return;
        }

        const reapPayload = event.payload;
        await this.stepEventPublisher.publishProcessEvent(
          workflowRunId,
          'execution.reaped',
          {
            executionId: event.aggregateId,
            jobId,
            failure_reason: reapPayload.failure_reason,
            error_message: reapPayload.error_message,
          },
        );

        const parentContainerIds = new Set(
          context.containerId ? [context.containerId] : [],
        );
        const recovery = await this.interruptionRecovery.prepareRecovery({
          workflowRunId,
          jobId,
          parentContainerIds,
          source: 'supervisor-reap',
          containerTier: context.containerTier,
          parentExecutionId: event.aggregateId,
        });
        parentResume = recovery.parentResume;
      }

      const errorMessage = this.resolveFailureMessage(event);

      this.logger.warn(
        `Execution ${event.aggregateId} failed — failing workflow run ${workflowRunId} job ${jobId}: ${errorMessage}`,
      );

      await this.runJobExecution.handleJobFailed(
        workflowRunId,
        jobId,
        errorMessage,
        parentResume,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle execution failure event for ${event.aggregateId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Looks up the execution record and returns its routing context only when
   * the execution is a workflow_step with both fields populated. Returns null
   * for any other execution kind or if the record is not found.
   */
  private async resolveWorkflowStepContext(executionId: string): Promise<{
    workflowRunId: string;
    jobId: string;
    state: ExecutionState;
    containerId?: string | null;
    containerTier?: number;
  } | null> {
    const execution = await this.executionRepo.findById(executionId);

    if (!execution) {
      this.logger.debug(
        `Execution ${executionId} not found — skipping workflow step routing`,
      );
      return null;
    }

    if (execution.kind !== 'workflow_step') {
      return null;
    }

    if (!execution.workflow_run_id || !execution.context_id) {
      this.logger.warn(
        `Execution ${executionId} is a workflow_step but missing workflow_run_id or context_id (jobId) — cannot route`,
      );
      return null;
    }

    return {
      workflowRunId: execution.workflow_run_id,
      jobId: execution.context_id,
      state: execution.state,
      containerId: execution.container_id,
      containerTier: execution.container_tier,
    };
  }

  private isSupersededExecution(state: ExecutionState): boolean {
    return state === 'cancelled';
  }

  /**
   * A step can only be advanced from a non-terminal pre-completion state. The
   * projector walks running -> completing -> completed for execution.completed,
   * so both 'running' and 'completing' are legitimate states from which the
   * first completion event advances the workflow. Any other state (completed,
   * failed, reaped, etc.) means the job was already advanced and a duplicate
   * completion event must not re-advance it.
   */
  private isAdvanceableExecution(state: ExecutionState): boolean {
    return state === 'running' || state === 'completing';
  }

  private resolveFailureMessage(event: DomainEventEnvelope): string {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (payload?.error_message && typeof payload.error_message === 'string') {
      return payload.error_message;
    }

    return `Execution ${event.aggregateId} failed (event: ${event.eventType})`;
  }
}
