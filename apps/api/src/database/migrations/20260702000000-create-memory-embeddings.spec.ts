import { describe, expect, it, vi } from 'vitest';
import { QueryRunner } from 'typeorm';
import { CreateMemoryEmbeddings20260702000000 } from './20260702000000-create-memory-embeddings';

describe('CreateMemoryEmbeddings20260702000000', () => {
  it('up() issues CREATE TABLE IF NOT EXISTS memory_embeddings', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateMemoryEmbeddings20260702000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const createTable = statements.find((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS memory_embeddings'),
    );
    expect(createTable).toBeDefined();
  });

  it('up() defines an unbounded vector column (no fixed dimension)', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateMemoryEmbeddings20260702000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const createTable = statements.find((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS memory_embeddings'),
    );
    expect(createTable).toBeDefined();
    // Unbounded vector: no fixed dimension like vector(384) or vector(1536)
    // Column name may be quoted: "embedding"    vector
    expect(createTable).toMatch(/"?embedding"?\s+vector\s+NOT NULL/);
    expect(createTable).not.toMatch(/vector\(\d+\)/);
  });

  it('up() adds a UNIQUE constraint on (owner_type, owner_id, model_id)', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateMemoryEmbeddings20260702000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const createTable = statements.find((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS memory_embeddings'),
    );
    expect(createTable).toBeDefined();
    expect(createTable).toMatch(
      /UNIQUE\s*\(\s*"?owner_type"?\s*,\s*"?owner_id"?\s*,\s*"?model_id"?\s*\)/,
    );
  });

  it('up() creates idx_memory_embeddings_owner index', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateMemoryEmbeddings20260702000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const ownerIndex = statements.find((s) =>
      s.includes('idx_memory_embeddings_owner'),
    );
    expect(ownerIndex).toBeDefined();
    expect(ownerIndex).toMatch(/owner_type/);
    expect(ownerIndex).toMatch(/owner_id/);
  });

  it('up() creates idx_memory_embeddings_model index', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateMemoryEmbeddings20260702000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const modelIndex = statements.find((s) =>
      s.includes('idx_memory_embeddings_model'),
    );
    expect(modelIndex).toBeDefined();
    expect(modelIndex).toMatch(/model_id/);
  });

  it('down() issues DROP TABLE IF EXISTS memory_embeddings', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateMemoryEmbeddings20260702000000().down(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const dropTable = statements.find((s) =>
      s.includes('DROP TABLE IF EXISTS memory_embeddings'),
    );
    expect(dropTable).toBeDefined();
  });

  it('is registered in registered-migrations', async () => {
    const { registeredMigrations } = await import('./registered-migrations.js');
    const names = registeredMigrations.map((m: { name: string }) => m.name);
    expect(names).toContain('CreateMemoryEmbeddings20260702000000');
    expect(names).toContain('EnablePgvector20260701000000');
    expect(names).toContain('AddEmbeddingModelColumns20260703000000');
  });
});
