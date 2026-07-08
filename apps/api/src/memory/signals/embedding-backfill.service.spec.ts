import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingBackfillService } from './embedding-backfill.service';

describe('EmbeddingBackfillService', () => {
  let service: EmbeddingBackfillService;
  const aiConfig = { resolveEmbeddingModelConfig: vi.fn() };
  const embeddingRepo = { findOwnersMissingEmbedding: vi.fn() };
  const consumer = { embedOwner: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    service = new EmbeddingBackfillService(
      aiConfig as any,
      embeddingRepo as any,
      consumer as any,
    );
  });

  it('(e1) returns zeros without calling repo when not configured', async () => {
    aiConfig.resolveEmbeddingModelConfig.mockResolvedValue({
      configured: false,
    });

    const result = await service.run();

    expect(result).toEqual({ embedded: 0, skipped: 0, errors: 0 });
    expect(embeddingRepo.findOwnersMissingEmbedding).not.toHaveBeenCalled();
  });

  it('(e2) calls embedOwner for each missing ID', async () => {
    aiConfig.resolveEmbeddingModelConfig.mockResolvedValue({
      configured: true,
      modelId: 'model-1',
    });
    embeddingRepo.findOwnersMissingEmbedding.mockImplementation(
      (ownerType: string) => {
        if (ownerType === 'memory_segment')
          return Promise.resolve(['seg-1', 'seg-2']);
        return Promise.resolve(['cand-1']);
      },
    );
    consumer.embedOwner.mockResolvedValue(undefined);

    const result = await service.run(2);

    expect(consumer.embedOwner).toHaveBeenCalledTimes(3);
    expect(result.embedded).toBe(3);
    expect(result.errors).toBe(0);
  });

  it('(e3) passes batchSize to findOwnersMissingEmbedding', async () => {
    aiConfig.resolveEmbeddingModelConfig.mockResolvedValue({
      configured: true,
      modelId: 'model-1',
    });
    embeddingRepo.findOwnersMissingEmbedding.mockResolvedValue([]);
    consumer.embedOwner.mockResolvedValue(undefined);

    await service.run(7);

    expect(embeddingRepo.findOwnersMissingEmbedding).toHaveBeenCalledWith(
      'memory_segment',
      'model-1',
      7,
    );
    expect(embeddingRepo.findOwnersMissingEmbedding).toHaveBeenCalledWith(
      'learning_candidate',
      'model-1',
      7,
    );
  });
});
