import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConcurrencyPolicyService } from './concurrency-policy.service';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import { WorkflowEventLogService } from './workflow-event-log.service';
import { IWorkflowDefinition, WorkflowStatus } from '@nexus/core';
import {
  resolveTriggerDedupeContext,
  buildStartDedupeKey,
} from './workflow-engine.utils';

@Injectable()
export class WorkflowConcurrencyManager {
  private readonly logger = new Logger(WorkflowConcurrencyManager.name);
  private readonly workflowStartLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly concurrencyPolicy: ConcurrencyPolicyService,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly eventLog: WorkflowEventLogService,
  ) {}

  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.workflowStartLocks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => task());
    const marker = next.then(() => undefined).catch(() => undefined);

    this.workflowStartLocks.set(key, marker);

    try {
      return await next;
    } finally {
      if (this.workflowStartLocks.get(key) === marker) {
        this.workflowStartLocks.delete(key);
      }
    }
  }

  async checkConcurrency(
    workflowId: string,
    triggerData: Record<string, unknown>,
    def: IWorkflowDefinition,
  ) {
    return this.concurrencyPolicy.checkAndApply(
      def.concurrency,
      workflowId,
      triggerData,
    );
  }

  resolveDedupeKey(
    workflowId: string,
    triggerData: Record<string, unknown>,
  ): string | null {
    const dedupeContext = resolveTriggerDedupeContext(triggerData);
    if (!dedupeContext) return null;
    return buildStartDedupeKey(workflowId, dedupeContext);
  }

  async findActiveRun(
    workflowId: string,
    triggerData: Record<string, unknown>,
  ) {
    const dedupeContext = resolveTriggerDedupeContext(triggerData);
    if (!dedupeContext) return null;

    return this.runRepo.findActiveByTriggerContext(workflowId, dedupeContext);
  }

  async findRunByDedupeKey(workflowId: string, dedupeKey: string) {
    return this.runRepo.findLatestByWorkflowAndDedupeKey(workflowId, dedupeKey);
  }

  async createQueuedRun(
    workflowId: string,
    triggerData: Record<string, unknown>,
    concurrencyScope: string,
  ): Promise<string> {
    const dedupeKey = triggerData.dedupeKey;
    if (typeof dedupeKey === 'string') {
      const existingByDedupeKey =
        await this.runRepo.findPendingByScopeAndDedupeKey(
          workflowId,
          concurrencyScope,
          dedupeKey,
        );

      if (existingByDedupeKey) {
        await this.eventLog.appendBestEffort({
          workflowRunId: existingByDedupeKey.id,
          eventType: 'workflow.queue_coalesced',
          payload: { workflowId, triggerData, concurrencyScope, dedupeKey },
        });

        this.logger.log(
          `Reusing queued workflow run ${existingByDedupeKey.id} for ${workflowId} scope=${concurrencyScope}`,
        );
        return existingByDedupeKey.id;
      }
    }

    const existing = await this.runRepo.findPendingByScopeAndTrigger(
      workflowId,
      concurrencyScope,
      triggerData,
    );

    if (existing) {
      await this.eventLog.appendBestEffort({
        workflowRunId: existing.id,
        eventType: 'workflow.queue_coalesced',
        payload: { workflowId, triggerData, concurrencyScope },
      });

      this.logger.log(
        `Reusing queued workflow run ${existing.id} for ${workflowId} scope=${concurrencyScope}`,
      );
      return existing.id;
    }

    const run = await this.runRepo
      .create({
        workflow_id: workflowId,
        status: WorkflowStatus.PENDING,
        state_variables: { trigger: triggerData },
        concurrency_scope: concurrencyScope,
        ...(typeof dedupeKey === 'string'
          ? { launch_dedupe_key: dedupeKey }
          : {}),
      })
      .catch(async (error: unknown) => {
        if (typeof dedupeKey !== 'string' || !this.isDuplicateKeyError(error)) {
          throw error;
        }

        const existingByDedupeKey =
          await this.runRepo.findLatestByWorkflowAndDedupeKey(
            workflowId,
            dedupeKey,
          );
        if (!existingByDedupeKey) {
          throw error;
        }

        return existingByDedupeKey;
      });

    await this.eventLog.appendBestEffort({
      workflowRunId: run.id,
      eventType: 'workflow.queued',
      payload: { workflowId, triggerData, concurrencyScope },
    });

    this.logger.log(
      `Queued workflow run ${run.id} for ${workflowId} scope=${concurrencyScope}`,
    );
    return run.id;
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.includes('duplicate key value violates unique constraint')
    );
  }
}
