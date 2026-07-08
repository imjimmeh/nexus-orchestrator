import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { isTerminalWorkflowRunStatus } from '@nexus/core';
import type { AgentAwaitStatus, SatisfiedChild } from '@nexus/core';
import { AgentAwaitEntity } from './agent-await.entity';
import { AgentAwaitRegistryService } from './agent-await-registry.service';
import { AgentAwaitRepository } from './agent-await.repository';
import { DependencyParentResumeService } from './dependency-parent-resume.service';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { WorkflowRunJobExecutionService } from '../workflow-run-job-execution.service';
import { StepEventPublisherService } from '../workflow-step-execution/step-event-publisher.service';

const STATUS_WAITING: AgentAwaitStatus = 'WAITING';
const STATUS_RESUMING: AgentAwaitStatus = 'RESUMING';
const STATUS_CANCELLED: AgentAwaitStatus = 'CANCELLED';

const EVENT_FAILED = 'agent_await.failed';

const RECONCILE_INTERVAL_MS = 30_000;

/** Grace window before a stuck `RESUMING` await is retried (overridable). */
export const DEFAULT_RESUME_GRACE_MS = 120_000;

/** Maximum reconcile-driven resume attempts before giving up on an await. */
export const MAX_RESUME_ATTEMPTS = 3;

export function resolveResumeGraceMs(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_RESUME_GRACE_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_RESUME_GRACE_MS;
  }
  return parsed;
}

const RESUME_GRACE_MS = resolveResumeGraceMs(
  process.env.AGENT_AWAIT_RESUME_GRACE_MS,
);

/**
 * Safety-net reconciler for the durable agent-await primitive.
 *
 * A parent run parked on awaited children is normally resumed by the terminal
 * event listener. That path can be lost when a `workflow.run.completed` event is
 * missed or the API restarts mid-resume. This interval-driven reconciler scans
 * non-terminal awaits and drives them forward:
 *
 * - WAITING awaits whose children are all terminal are promoted to RESUMING and
 *   resumed (lost-event recovery).
 * - RESUMING awaits stuck past the grace window are retried (interrupted-resume
 *   recovery), bounded by an in-memory attempt counter; after the cap the await
 *   is cancelled and its parent run is failed so the stall is visible/repairable.
 *
 * Domain-neutral: deals only in run, step, and session identifiers.
 */
@Injectable()
export class AgentAwaitReconcilerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AgentAwaitReconcilerService.name);
  private reconcileTimer: NodeJS.Timeout | null = null;
  private reconcileInFlight = false;
  private readonly resumeAttempts = new Map<string, number>();

  constructor(
    private readonly awaitRepo: AgentAwaitRepository,
    private readonly registry: AgentAwaitRegistryService,
    private readonly parentResume: DependencyParentResumeService,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly jobExecution: WorkflowRunJobExecutionService,
    private readonly eventPublisher: StepEventPublisherService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileOnce();

    this.reconcileTimer = setInterval(() => {
      void this.reconcileOnce();
    }, RECONCILE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  async reconcileOnce(): Promise<void> {
    if (this.reconcileInFlight) {
      return;
    }

    this.reconcileInFlight = true;
    try {
      const awaits = await this.awaitRepo.findNonTerminal();
      for (const record of awaits) {
        await this.reconcileAwait(record);
      }
    } catch (error) {
      this.logger.error(
        `Agent await reconciliation failed: ${this.describe(error)}`,
      );
    } finally {
      this.reconcileInFlight = false;
    }
  }

  private async reconcileAwait(record: AgentAwaitEntity): Promise<void> {
    if (record.status === STATUS_WAITING) {
      await this.reconcileWaiting(record);
      return;
    }
    if (record.status === STATUS_RESUMING) {
      await this.reconcileResuming(record);
    }
  }

  /**
   * Re-checks every awaited child's current run status. Now-terminal children
   * are marked satisfied through the registry (sharing the resume path); when
   * all children are terminal the await is promoted to RESUMING and resumed.
   */
  private async reconcileWaiting(record: AgentAwaitEntity): Promise<void> {
    let allTerminal = true;

    for (const childRunId of record.awaited_run_ids) {
      const terminalStatus = await this.resolveTerminalChildStatus(childRunId);
      if (terminalStatus === null) {
        allTerminal = false;
        continue;
      }
      await this.registry.onChildTerminal(childRunId, terminalStatus);
    }

    if (!allTerminal) {
      return;
    }

    const promoted = await this.awaitRepo.compareAndSetStatus(
      record.id,
      STATUS_WAITING,
      STATUS_RESUMING,
    );
    if (!promoted) {
      // Another path (listener or a concurrent pass) already promoted it.
      return;
    }

    const refreshed = await this.awaitRepo.findById(record.id);
    await this.attemptResume(refreshed ?? record);
  }

  /**
   * Retries a resume that started but never completed once it has been stuck
   * past the grace window, bounded by {@link MAX_RESUME_ATTEMPTS}.
   */
  private async reconcileResuming(record: AgentAwaitEntity): Promise<void> {
    if (!this.isOlderThanGrace(record.updated_at)) {
      return;
    }
    await this.attemptResume(record);
  }

  private async attemptResume(record: AgentAwaitEntity): Promise<void> {
    if (this.attemptsFor(record.id) >= MAX_RESUME_ATTEMPTS) {
      await this.giveUp(record);
      return;
    }

    this.recordAttempt(record.id);
    try {
      await this.parentResume.resumeParent(record);
      this.resumeAttempts.delete(record.id);
    } catch (error) {
      this.logger.error(
        `Agent await ${record.id} resume retry failed ` +
          `(attempt ${this.attemptsFor(record.id).toString()}/${MAX_RESUME_ATTEMPTS.toString()}): ` +
          this.describe(error),
      );
    }
  }

  /**
   * Abandons an await that exhausted its resume budget: it is cancelled, the
   * parent's wait-state is cleared, the parent run is failed (so the stall is
   * visible and repairable), and an `agent_await.failed` event is emitted.
   */
  private async giveUp(record: AgentAwaitEntity): Promise<void> {
    const reason =
      `Agent await ${record.id} could not be resumed after ` +
      `${MAX_RESUME_ATTEMPTS.toString()} attempts; failing parked parent run ` +
      `${record.parent_run_id}.`;

    await this.awaitRepo.compareAndSetStatus(
      record.id,
      STATUS_RESUMING,
      STATUS_CANCELLED,
    );
    await this.runRepo.clearWaitState(record.parent_run_id);
    await this.jobExecution.handleJobFailed(
      record.parent_run_id,
      record.parent_step_id,
      reason,
    );
    await this.eventPublisher.publishProcessEvent(
      record.parent_run_id,
      EVENT_FAILED,
      {
        awaitId: record.id,
        reason: 'resume_attempts_exhausted',
        attempts: MAX_RESUME_ATTEMPTS,
      },
    );

    this.resumeAttempts.delete(record.id);
    this.logger.error(reason);
  }

  /**
   * Returns the child run's terminal status if it has reached one, else null.
   * Non-terminal (or missing) child runs return null so the await keeps waiting.
   */
  private async resolveTerminalChildStatus(
    childRunId: string,
  ): Promise<SatisfiedChild['status'] | null> {
    const run = await this.runRepo.findById(childRunId);
    if (!run || !isTerminalWorkflowRunStatus(run.status)) {
      return null;
    }
    return run.status as SatisfiedChild['status'];
  }

  private isOlderThanGrace(updatedAt: Date | undefined): boolean {
    const timestamp = updatedAt?.getTime();
    if (!timestamp) {
      return false;
    }
    return Date.now() - timestamp >= RESUME_GRACE_MS;
  }

  private attemptsFor(awaitId: string): number {
    return this.resumeAttempts.get(awaitId) ?? 0;
  }

  private recordAttempt(awaitId: string): void {
    this.resumeAttempts.set(awaitId, this.attemptsFor(awaitId) + 1);
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
