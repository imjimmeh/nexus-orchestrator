import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChatSessionStatus, ChatSessionJobData } from '@nexus/core';
import { ChatExecutionService } from './chat-execution.service';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';
import { CHAT_SESSION_FAILED_EVENT } from './chat-session-events.constants';

const CHAT_SESSION_RETRY_JOB_ID_PREFIX = 'chat-session-retry:';

@Injectable()
@Processor('chat-sessions', { concurrency: 4 })
export class ChatSessionConsumer extends WorkerHost {
  private readonly logger = new Logger(ChatSessionConsumer.name);

  constructor(
    private readonly chatExecutionService: ChatExecutionService,
    private readonly chatSessionRepo: ChatSessionRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<ChatSessionJobData>): Promise<void> {
    const { chatSessionId, agentProfileName } = job.data;

    this.logger.log(
      `Processing chat session ${chatSessionId} with agent ${agentProfileName} (job ${job.id})`,
    );

    if (await this.shouldSkipRetryJob(job)) {
      return;
    }

    try {
      await this.chatExecutionService.executeChatSession(job.data);
      this.logger.log(`Chat session ${chatSessionId} processed successfully`);
    } catch (error) {
      this.logger.error(
        `Chat session ${chatSessionId} processing failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job<ChatSessionJobData>): void {
    this.logger.log(
      `Chat session job ${job.id} activated for session ${job.data.chatSessionId}`,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<ChatSessionJobData>): void {
    this.logger.log(
      `Chat session job ${job.id} completed for session ${job.data.chatSessionId}`,
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ChatSessionJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) {
      return;
    }

    if (this.shouldSkipFinalFailureHandling(job)) {
      this.logger.warn(
        `Chat session ${job.data.chatSessionId} failed (attempt ${job.attemptsMade}), retrying...`,
      );
      return;
    }

    this.logger.error(
      `Chat session ${job.data.chatSessionId} permanently failed after ${job.attemptsMade} attempts: ${error.message}`,
    );

    await this.chatSessionRepo.update(job.data.chatSessionId, {
      status: ChatSessionStatus.FAILED,
      execution_state: 'failed',
      error_message: error.message,
      completed_at: new Date(),
    });

    this.eventEmitter.emit(CHAT_SESSION_FAILED_EVENT, {
      sessionId: job.data.chatSessionId,
      status: ChatSessionStatus.FAILED,
    });
  }

  private shouldSkipFinalFailureHandling(
    job: Job<ChatSessionJobData>,
  ): boolean {
    const maxAttempts =
      typeof job.opts.attempts === 'number' && job.opts.attempts > 0
        ? job.opts.attempts
        : 1;

    return job.attemptsMade < maxAttempts;
  }

  private async shouldSkipRetryJob(
    job: Job<ChatSessionJobData>,
  ): Promise<boolean> {
    const retryJobId = this.getRetryJobId(job);
    if (!retryJobId) {
      return false;
    }

    const session = await this.chatSessionRepo.findById(job.data.chatSessionId);
    if (!session) {
      this.logger.warn(
        `Skipping stale retry job ${retryJobId}: chat session ${job.data.chatSessionId} no longer exists`,
      );
      return true;
    }

    if (this.isTerminalStatus(session.status)) {
      this.logger.warn(
        `Skipping stale retry job ${retryJobId}: chat session ${job.data.chatSessionId} is ${session.status}`,
      );
      return true;
    }

    if (session.status !== ChatSessionStatus.RUNNING) {
      this.logger.warn(
        `Skipping stale retry job ${retryJobId}: chat session ${job.data.chatSessionId} is not RUNNING`,
      );
      return true;
    }

    if (session.execution_state !== 'retry_scheduled') {
      this.logger.warn(
        `Skipping stale retry job ${retryJobId}: chat session ${job.data.chatSessionId} is not retry_scheduled`,
      );
      return true;
    }

    const retryMetadata = this.getRetryMetadata(session.retry_metadata);
    const expectedAttempt = this.getRetryAttemptFromJobId(retryJobId);
    if (
      retryMetadata.retryJobId !== retryJobId ||
      retryMetadata.attempt !== expectedAttempt
    ) {
      this.logger.warn(
        `Skipping stale retry job ${retryJobId}: chat session ${job.data.chatSessionId} retry metadata does not match`,
      );
      return true;
    }

    return false;
  }

  private getRetryJobId(job: Job<ChatSessionJobData>): string | undefined {
    const jobId = job.id ?? '';
    return jobId.startsWith(CHAT_SESSION_RETRY_JOB_ID_PREFIX)
      ? jobId
      : undefined;
  }

  private isTerminalStatus(status: ChatSessionStatus): boolean {
    return [
      ChatSessionStatus.CANCELLED,
      ChatSessionStatus.COMPLETED,
      ChatSessionStatus.FAILED,
    ].includes(status);
  }

  private getRetryMetadata(retryMetadata: unknown): {
    attempt?: number;
    retryJobId?: string;
  } {
    if (!retryMetadata || typeof retryMetadata !== 'object') {
      return {};
    }

    const metadata = retryMetadata as {
      attempt?: unknown;
      retryJobId?: unknown;
    };
    return {
      attempt:
        typeof metadata.attempt === 'number' ? metadata.attempt : undefined,
      retryJobId:
        typeof metadata.retryJobId === 'string'
          ? metadata.retryJobId
          : undefined,
    };
  }

  private getRetryAttemptFromJobId(retryJobId: string): number | undefined {
    const attempt = Number(retryJobId.split(':').at(-1));
    return Number.isInteger(attempt) && attempt > 0 ? attempt : undefined;
  }
}
