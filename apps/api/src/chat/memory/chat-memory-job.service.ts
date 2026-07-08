import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ChatMemoryJobRepository } from '../database/repositories/chat-memory-job.repository';
import { resolveChatMemoryConfig } from './chat-memory.config';
import { ChatMemoryDistillationService } from './chat-memory-distillation.service';
import { ChatMemoryMetricsService } from './chat-memory-metrics.service';
import type {
  EnqueueConsolidationJobInput,
  EnqueueDistillationJobInput,
} from './chat-memory.types';

@Injectable()
export class ChatMemoryJobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatMemoryJobService.name);
  private readonly config = resolveChatMemoryConfig();
  private intervalHandle: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor(
    private readonly jobs: ChatMemoryJobRepository,
    private readonly distillation: ChatMemoryDistillationService,
    private readonly metrics: ChatMemoryMetricsService,
  ) {}

  onModuleInit(): void {
    if (this.readJobsDisabledFlag()) {
      this.logger.log('Chat memory background jobs disabled by configuration');
      return;
    }

    this.intervalHandle = setInterval(() => {
      void this.pollOnce();
    }, this.config.pollIntervalMs);

    this.logger.log(
      `Chat memory job poller started with interval ${this.config.pollIntervalMs}ms`,
    );
  }

  onModuleDestroy(): void {
    if (!this.intervalHandle) {
      return;
    }

    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  async enqueueDistillation(input: EnqueueDistillationJobInput): Promise<void> {
    await this.jobs.enqueue({
      job_type: 'distill_session',
      status: 'pending',
      chat_session_id: input.chatSessionId,
      profile_id: input.profileId,
      trigger_reason: input.triggerReason,
      idempotency_key: input.idempotencyKey,
      payload: null,
      max_attempts: this.config.maxAttempts,
    });
  }

  async enqueueConsolidation(
    input: EnqueueConsolidationJobInput,
  ): Promise<void> {
    await this.jobs.enqueue({
      job_type: 'consolidate_profile',
      status: 'pending',
      chat_session_id: null,
      profile_id: input.profileId,
      trigger_reason: input.triggerReason,
      idempotency_key: input.idempotencyKey,
      payload: null,
      max_attempts: this.config.maxAttempts,
    });
  }

  async pollOnce(): Promise<void> {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    try {
      await this.processNextJob();
    } catch (error) {
      this.logger.warn(
        `Chat memory job poll iteration failed: ${(error as Error).message}`,
      );
    } finally {
      this.isPolling = false;
    }
  }

  private async processNextJob(): Promise<void> {
    const claimed = await this.jobs.claimNextPending(new Date());
    if (!claimed) {
      return;
    }

    try {
      await this.executeJob(claimed);
      await this.jobs.update(claimed.id, {
        status: 'completed',
        completed_at: new Date(),
      });

      if (claimed.job_type === 'distill_session') {
        this.metrics.recordDistillationSuccess();
      }
    } catch (error) {
      await this.handleJobFailure(claimed, error as Error);

      if (claimed.job_type === 'distill_session') {
        this.metrics.recordDistillationFailure();
      }
    }
  }

  private async executeJob(job: {
    id: string;
    job_type: 'distill_session' | 'consolidate_profile';
    chat_session_id?: string | null;
    profile_id?: string | null;
    trigger_reason: string;
  }): Promise<void> {
    const correlationId = randomUUID();

    if (job.job_type === 'distill_session') {
      if (!job.chat_session_id || !job.profile_id) {
        throw new Error(
          `Distillation job ${job.id} is missing required linkage`,
        );
      }

      await this.distillation.distillSessionMemory({
        chatSessionId: job.chat_session_id,
        profileId: job.profile_id,
        correlationId,
        triggerReason: job.trigger_reason,
      });

      await this.enqueueConsolidation({
        profileId: job.profile_id,
        triggerReason: 'distillation',
        idempotencyKey: `consolidate:${job.profile_id}:${job.id}`,
      });

      return;
    }

    if (!job.profile_id) {
      throw new Error(`Consolidation job ${job.id} is missing profile linkage`);
    }

    await this.distillation.consolidateProfileMemory({
      profileId: job.profile_id,
      correlationId,
      triggerReason: job.trigger_reason,
    });
  }

  private async handleJobFailure(
    job: {
      id: string;
      attempts: number;
      max_attempts: number;
      trigger_reason: string;
    },
    error: Error,
  ): Promise<void> {
    const exhausted = job.attempts >= job.max_attempts;

    if (exhausted) {
      await this.jobs.update(job.id, {
        status: 'failed',
        completed_at: new Date(),
        last_error: error.message,
      });
      this.logger.error(
        `Chat memory job ${job.id} failed permanently: ${error.message}`,
      );
      return;
    }

    const retryAt = new Date(Date.now() + this.config.retryDelayMs);
    await this.jobs.update(job.id, {
      status: 'pending',
      scheduled_at: retryAt,
      last_error: error.message,
    });

    this.logger.warn(
      `Chat memory job ${job.id} failed; retrying at ${retryAt.toISOString()}`,
    );
  }

  private readJobsDisabledFlag(): boolean {
    const raw = process.env.CHAT_MEMORY_JOBS_DISABLED;
    if (typeof raw !== 'string') {
      return false;
    }

    return raw.trim().toLowerCase() === 'true';
  }
}
