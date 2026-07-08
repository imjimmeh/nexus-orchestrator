import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import { MemoryEmbeddingRepository } from '../database/repositories/memory-embedding.repository';
import { MemorySegmentCrudRepository } from '../database/repositories/memory-segment.crud.repository';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import { EmbeddingProviderService } from './embedding-provider.service';
import {
  EMBEDDING_WRITE_QUEUE,
  EMBEDDING_WRITE_JOB,
} from './embedding-write.constants';
import type { EmbeddingWriteJobData, OwnerType } from './embedding-write.types';

function computeHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

@Injectable()
@Processor(EMBEDDING_WRITE_QUEUE)
export class EmbeddingWriteConsumer extends WorkerHost {
  private readonly logger = new Logger(EmbeddingWriteConsumer.name);

  constructor(
    private readonly aiConfig: AiConfigurationService,
    private readonly embeddingService: EmbeddingProviderService,
    private readonly embeddingRepo: MemoryEmbeddingRepository,
    private readonly memorySegments: MemorySegmentCrudRepository,
    private readonly candidates: LearningCandidateRepository,
  ) {
    super();
  }

  async process(job: Job<EmbeddingWriteJobData>): Promise<void> {
    if (job.name !== EMBEDDING_WRITE_JOB) {
      this.logger.debug(
        `EmbeddingWriteConsumer: skipping unknown job name "${job.name}"`,
      );
      return;
    }

    await this.embedOwner(job.data.ownerType, job.data.ownerId);
  }

  /**
   * Compute and persist the embedding for the given owner record.
   *
   * Idempotent: if an existing row already has a matching content_hash for the
   * current model, the call is a no-op. Public so the backfill service can
   * reuse this path without re-enqueuing.
   */
  async embedOwner(ownerType: OwnerType, ownerId: string): Promise<void> {
    const config = await this.aiConfig.resolveEmbeddingModelConfig();
    if (!config.configured) {
      return;
    }

    const content = await this.loadContent(ownerType, ownerId);
    if (content === null) {
      return;
    }

    const contentHash = computeHash(content);

    const existing = await this.embeddingRepo.findByOwnerAndModel(
      ownerType,
      ownerId,
      config.modelId,
    );
    if (existing !== null && existing.content_hash === contentHash) {
      return;
    }

    const result = await this.embeddingService.embed([content]);
    if (!result.configured) {
      return;
    }

    await this.embeddingRepo.upsertSafe({
      owner_type: ownerType,
      owner_id: ownerId,
      model_id: result.modelId,
      dim: result.dim,
      embedding: result.vectors[0],
      content_hash: contentHash,
    });
  }

  private async loadContent(
    ownerType: OwnerType,
    ownerId: string,
  ): Promise<string | null> {
    if (ownerType === 'memory_segment') {
      const segment = await this.memorySegments.findById(ownerId);
      return segment?.content ?? null;
    }

    const candidate = await this.candidates.findById(ownerId);
    return candidate?.summary ?? null;
  }
}
