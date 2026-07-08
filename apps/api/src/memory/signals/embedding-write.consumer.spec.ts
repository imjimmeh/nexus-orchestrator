import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingWriteConsumer } from './embedding-write.consumer';
import { EMBEDDING_WRITE_JOB } from './embedding-write.constants';

describe('EmbeddingWriteConsumer', () => {
  let consumer: EmbeddingWriteConsumer;
  const aiConfig = { resolveEmbeddingModelConfig: vi.fn() };
  const embeddingService = { embed: vi.fn() };
  const embeddingRepo = { findByOwnerAndModel: vi.fn(), upsertSafe: vi.fn() };
  const segmentRepo = { findById: vi.fn() };
  const candidateRepo = { findById: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    consumer = new EmbeddingWriteConsumer(
      aiConfig as any,
      embeddingService as any,
      embeddingRepo as any,
      segmentRepo as any,
      candidateRepo as any,
    );
  });

  it('(a) returns early when model not configured', async () => {
    aiConfig.resolveEmbeddingModelConfig.mockResolvedValue({
      configured: false,
    });

    await consumer.embedOwner('memory_segment', 'seg-1');

    expect(embeddingService.embed).not.toHaveBeenCalled();
    expect(embeddingRepo.upsertSafe).not.toHaveBeenCalled();
  });

  it('(b) embeds and upserts when configured and content is new', async () => {
    aiConfig.resolveEmbeddingModelConfig.mockResolvedValue({
      configured: true,
      modelId: 'model-1',
    });
    segmentRepo.findById.mockResolvedValue({
      id: 'seg-1',
      content: 'hello world',
    });
    embeddingRepo.findByOwnerAndModel.mockResolvedValue(null);
    embeddingService.embed.mockResolvedValue({
      configured: true,
      modelId: 'model-1',
      dim: 3,
      vectors: [[0.1, 0.2, 0.3]],
    });
    embeddingRepo.upsertSafe.mockResolvedValue(undefined);

    await consumer.embedOwner('memory_segment', 'seg-1');

    expect(embeddingService.embed).toHaveBeenCalledWith(['hello world']);
    expect(embeddingRepo.upsertSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_type: 'memory_segment',
        owner_id: 'seg-1',
        model_id: 'model-1',
        dim: 3,
        embedding: [0.1, 0.2, 0.3],
      }),
    );
  });

  it('(c) skips when existing row has matching content_hash', async () => {
    aiConfig.resolveEmbeddingModelConfig.mockResolvedValue({
      configured: true,
      modelId: 'model-1',
    });
    segmentRepo.findById.mockResolvedValue({
      id: 'seg-1',
      content: 'hello world',
    });

    const { createHash } = await import('crypto');
    const hash = createHash('sha256')
      .update('hello world', 'utf8')
      .digest('hex');
    embeddingRepo.findByOwnerAndModel.mockResolvedValue({ content_hash: hash });

    await consumer.embedOwner('memory_segment', 'seg-1');

    expect(embeddingService.embed).not.toHaveBeenCalled();
    expect(embeddingRepo.upsertSafe).not.toHaveBeenCalled();
  });

  it('(d) ignores jobs with wrong name', async () => {
    await consumer.process({
      name: 'other-job',
      data: { ownerType: 'memory_segment', ownerId: 'seg-1' },
    } as any);

    expect(embeddingService.embed).not.toHaveBeenCalled();
    expect(embeddingRepo.upsertSafe).not.toHaveBeenCalled();
  });
});
