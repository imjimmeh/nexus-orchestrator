import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingReindexService } from './embedding-reindex.service';
import type { EmbeddingActiveModelChangedEvent } from '../../ai-config/events/embedding-model.events';

describe('EmbeddingReindexService', () => {
  const backfill = { run: vi.fn() };
  const embeddingRepo = { deleteByNonActiveModel: vi.fn() };
  const aiConfig = { resolveEmbeddingModelConfig: vi.fn() };

  let service: EmbeddingReindexService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new EmbeddingReindexService(
      backfill as any,
      embeddingRepo as any,
      aiConfig as any,
    );
  });

  describe('reindexActiveModel()', () => {
    it('(r1) is a no-op when no embedding model is configured', async () => {
      aiConfig.resolveEmbeddingModelConfig.mockResolvedValue({
        configured: false,
      });

      await service.reindexActiveModel();

      expect(backfill.run).not.toHaveBeenCalled();
      expect(embeddingRepo.deleteByNonActiveModel).not.toHaveBeenCalled();
    });

    it('(r2) loops backfill until exhausted then GCs non-active-model rows once', async () => {
      aiConfig.resolveEmbeddingModelConfig.mockResolvedValue({
        configured: true,
        modelId: 'model-abc',
      });
      // Three productive batches, the fourth drains (embedded:0) → loop ends.
      backfill.run
        .mockResolvedValueOnce({ embedded: 50, skipped: 0, errors: 0 })
        .mockResolvedValueOnce({ embedded: 50, skipped: 0, errors: 0 })
        .mockResolvedValueOnce({ embedded: 12, skipped: 0, errors: 0 })
        .mockResolvedValueOnce({ embedded: 0, skipped: 0, errors: 0 });
      embeddingRepo.deleteByNonActiveModel.mockResolvedValue(3);

      await service.reindexActiveModel();

      expect(backfill.run).toHaveBeenCalledTimes(4);
      expect(embeddingRepo.deleteByNonActiveModel).toHaveBeenCalledTimes(1);
      expect(embeddingRepo.deleteByNonActiveModel).toHaveBeenCalledWith(
        'model-abc',
      );
    });

    it('(r3) GC runs exactly once AFTER the whole backfill loop completes', async () => {
      const callOrder: string[] = [];
      aiConfig.resolveEmbeddingModelConfig.mockResolvedValue({
        configured: true,
        modelId: 'model-xyz',
      });
      let batch = 0;
      backfill.run.mockImplementation(async () => {
        callOrder.push('backfill');
        batch += 1;
        // Two productive batches, then drained.
        return { embedded: batch <= 2 ? 5 : 0, skipped: 0, errors: 0 };
      });
      embeddingRepo.deleteByNonActiveModel.mockImplementation(async () => {
        callOrder.push('gc');
        return 0;
      });

      await service.reindexActiveModel();

      expect(callOrder).toEqual(['backfill', 'backfill', 'backfill', 'gc']);
    });

    it('(r4) continues and logs when backfill throws (fail-soft)', async () => {
      aiConfig.resolveEmbeddingModelConfig.mockResolvedValue({
        configured: true,
        modelId: 'model-abc',
      });
      backfill.run.mockRejectedValue(new Error('embed failure'));
      embeddingRepo.deleteByNonActiveModel.mockResolvedValue(0);

      // Should not throw
      await expect(service.reindexActiveModel()).resolves.toBeUndefined();
      // GC should still run
      expect(embeddingRepo.deleteByNonActiveModel).toHaveBeenCalledWith(
        'model-abc',
      );
    });
  });

  describe('onActiveModelChanged()', () => {
    it('(r5) calls reindexActiveModel when the event fires', async () => {
      const spy = vi
        .spyOn(service, 'reindexActiveModel')
        .mockResolvedValue(undefined);

      const event: EmbeddingActiveModelChangedEvent = {
        activeModelId: 'model-new',
        previousModelId: 'model-old',
      };

      await service.onActiveModelChanged(event);

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
