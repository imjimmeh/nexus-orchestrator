import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  EMBEDDING_WRITE_QUEUE,
  EMBEDDING_WRITE_JOB,
} from './embedding-write.constants';
import type { EmbeddingWriteJobData, OwnerType } from './embedding-write.types';

/**
 * Thin fire-and-forget wrapper that enqueues embedding jobs.
 *
 * Lazy-gate design: this service ALWAYS enqueues regardless of whether an
 * embedding model is configured. The consumer performs the configuration
 * check and no-ops cheaply when nothing is configured. This keeps the write
 * path (createMemorySegment, recordLearning) free from any I/O or DB calls.
 */
@Injectable()
export class EmbeddingWriteEnqueueService {
  private readonly logger = new Logger(EmbeddingWriteEnqueueService.name);

  constructor(
    @InjectQueue(EMBEDDING_WRITE_QUEUE)
    private readonly queue: Queue<EmbeddingWriteJobData>,
  ) {}

  /**
   * Enqueue an embedding job for the given owner. Fire-and-forget: errors are
   * logged but never thrown to the caller.
   */
  enqueueOwner(ownerType: OwnerType, ownerId: string): void {
    this.queue
      .add(EMBEDDING_WRITE_JOB, { ownerType, ownerId })
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to enqueue embedding job for ${ownerType}:${ownerId} — ${String(err)}`,
        );
      });
  }
}
