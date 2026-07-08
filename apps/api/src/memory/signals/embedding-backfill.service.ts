import { Injectable, Logger } from '@nestjs/common';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import { MemoryEmbeddingRepository } from '../database/repositories/memory-embedding.repository';
import { EmbeddingWriteConsumer } from './embedding-write.consumer';

@Injectable()
export class EmbeddingBackfillService {
  private readonly logger = new Logger(EmbeddingBackfillService.name);

  constructor(
    private readonly aiConfig: AiConfigurationService,
    private readonly embeddingRepo: MemoryEmbeddingRepository,
    private readonly consumer: EmbeddingWriteConsumer,
  ) {}

  async run(
    batchSize = 50,
  ): Promise<{ embedded: number; skipped: number; errors: number }> {
    const config = await this.aiConfig.resolveEmbeddingModelConfig();
    if (!config.configured) {
      return { embedded: 0, skipped: 0, errors: 0 };
    }

    const [segmentIds, candidateIds] = await Promise.all([
      this.embeddingRepo.findOwnersMissingEmbedding(
        'memory_segment',
        config.modelId,
        batchSize,
      ),
      this.embeddingRepo.findOwnersMissingEmbedding(
        'learning_candidate',
        config.modelId,
        batchSize,
      ),
    ]);

    let embedded = 0;
    let errors = 0;

    for (const id of segmentIds) {
      try {
        await this.consumer.embedOwner('memory_segment', id);
        embedded++;
      } catch (err) {
        this.logger.error(
          `Backfill failed for memory_segment:${id} — ${String(err)}`,
        );
        errors++;
      }
    }

    for (const id of candidateIds) {
      try {
        await this.consumer.embedOwner('learning_candidate', id);
        embedded++;
      } catch (err) {
        this.logger.error(
          `Backfill failed for learning_candidate:${id} — ${String(err)}`,
        );
        errors++;
      }
    }

    return { embedded, skipped: 0, errors };
  }
}
