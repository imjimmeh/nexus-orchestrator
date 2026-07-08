import { describe, expect, it, vi } from 'vitest';
import { Repository } from 'typeorm';
import { MemoryEmbeddingRepository } from './memory-embedding.repository';
import { MemoryEmbedding } from '../entities/memory-embedding.entity';

function makeRepo() {
  const inner = {
    create: vi.fn(),
    save: vi.fn(),
    findOne: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
  } as unknown as Repository<MemoryEmbedding>;
  return { inner, repo: new MemoryEmbeddingRepository(inner) };
}

describe('MemoryEmbeddingRepository.upsert()', () => {
  it('throws when embedding length does not match dim', async () => {
    const { repo } = makeRepo();
    await expect(
      repo.upsert({
        owner_type: 'memory_segment',
        owner_id: 'aaaaaaaa-0000-0000-0000-000000000001',
        model_id: 'bbbbbbbb-0000-0000-0000-000000000001',
        dim: 384,
        embedding: new Array(512).fill(0.1), // wrong length
        content_hash: 'abc123',
      }),
    ).rejects.toThrow(/dimension mismatch/i);
  });

  it('throws when dim is 0', async () => {
    const { repo } = makeRepo();
    await expect(
      repo.upsert({
        owner_type: 'memory_segment',
        owner_id: 'aaaaaaaa-0000-0000-0000-000000000001',
        model_id: 'bbbbbbbb-0000-0000-0000-000000000001',
        dim: 0,
        embedding: [],
        content_hash: 'abc123',
      }),
    ).rejects.toThrow(/dimension mismatch/i);
  });

  it('does not throw and calls save when embedding length matches dim', async () => {
    const { inner, repo } = makeRepo();
    const embedding = new Array(384).fill(0.5);
    const saved: Partial<MemoryEmbedding> = {
      id: 'cccccccc-0000-0000-0000-000000000001',
      owner_type: 'memory_segment',
      owner_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      model_id: 'bbbbbbbb-0000-0000-0000-000000000001',
      dim: 384,
      embedding: JSON.stringify(embedding),
      content_hash: 'hash384',
      created_at: new Date(),
    };
    vi.mocked(inner.create).mockReturnValue(saved as MemoryEmbedding);
    vi.mocked(inner.save).mockResolvedValue(saved as MemoryEmbedding);

    const result = await repo.upsert({
      owner_type: 'memory_segment',
      owner_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      model_id: 'bbbbbbbb-0000-0000-0000-000000000001',
      dim: 384,
      embedding,
      content_hash: 'hash384',
    });

    expect(inner.save).toHaveBeenCalledOnce();
    expect(result).toBeDefined();
  });

  it('serialises the embedding vector as pgvector literal [n1,n2,...] text', async () => {
    const { inner, repo } = makeRepo();
    const embedding = [0.1, 0.2, 0.3];
    const captured: Partial<MemoryEmbedding>[] = [];
    vi.mocked(inner.create).mockImplementation((data) => {
      captured.push(data as Partial<MemoryEmbedding>);
      return data as MemoryEmbedding;
    });
    vi.mocked(inner.save).mockImplementation((entity) =>
      Promise.resolve(entity as MemoryEmbedding),
    );

    await repo.upsert({
      owner_type: 'learning_candidate',
      owner_id: 'aaaaaaaa-0000-0000-0000-000000000002',
      model_id: 'bbbbbbbb-0000-0000-0000-000000000002',
      dim: 3,
      embedding,
      content_hash: 'xyz',
    });

    expect(captured[0]?.embedding).toBe('[0.1,0.2,0.3]');
  });
});

describe('MemoryEmbeddingRepository.upsertSafe()', () => {
  it('throws when embedding length does not match dim', async () => {
    const { repo } = makeRepo();
    await expect(
      repo.upsertSafe({
        owner_type: 'memory_segment',
        owner_id: 'aaaaaaaa-0000-0000-0000-000000000001',
        model_id: 'bbbbbbbb-0000-0000-0000-000000000001',
        dim: 384,
        embedding: new Array(512).fill(0.1), // wrong length
        content_hash: 'abc123',
      }),
    ).rejects.toThrow(/dimension mismatch/i);
  });

  it('calls repository.upsert with conflict columns [owner_type, owner_id, model_id]', async () => {
    const { inner, repo } = makeRepo();
    vi.mocked(inner.upsert).mockResolvedValue({
      identifiers: [],
      generatedMaps: [],
      raw: [],
    });

    const embedding = [0.1, 0.2, 0.3];
    await repo.upsertSafe({
      owner_type: 'memory_segment',
      owner_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      model_id: 'bbbbbbbb-0000-0000-0000-000000000001',
      dim: 3,
      embedding,
      content_hash: 'hash-xyz',
    });

    expect(inner.upsert).toHaveBeenCalledOnce();
    expect(inner.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          owner_type: 'memory_segment',
          owner_id: 'aaaaaaaa-0000-0000-0000-000000000001',
          model_id: 'bbbbbbbb-0000-0000-0000-000000000001',
          dim: 3,
          embedding: '[0.1,0.2,0.3]',
          content_hash: 'hash-xyz',
        }),
      ]),
      ['owner_type', 'owner_id', 'model_id'],
    );
  });
});
