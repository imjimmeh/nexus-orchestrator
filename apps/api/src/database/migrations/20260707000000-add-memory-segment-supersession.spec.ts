import { describe, expect, it, vi } from 'vitest';
import { QueryRunner } from 'typeorm';
import { AddMemorySegmentSupersession20260707000000 } from './20260707000000-add-memory-segment-supersession';

describe('AddMemorySegmentSupersession20260707000000', () => {
  it('up() adds supersedes + superseded_by uuid columns with IF NOT EXISTS (idempotent)', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new AddMemorySegmentSupersession20260707000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const alter = statements.find((s) =>
      s.includes('ALTER TABLE memory_segments'),
    );
    expect(alter).toBeDefined();
    expect(alter).toMatch(/ADD COLUMN IF NOT EXISTS supersedes uuid/);
    expect(alter).toMatch(/ADD COLUMN IF NOT EXISTS superseded_by uuid/);
  });

  it('up() creates idx_memory_segments_superseded_by index with IF NOT EXISTS', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new AddMemorySegmentSupersession20260707000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const index = statements.find((s) =>
      s.includes('idx_memory_segments_superseded_by'),
    );
    expect(index).toBeDefined();
    expect(index).toMatch(/CREATE INDEX IF NOT EXISTS/);
    expect(index).toMatch(/superseded_by/);
  });

  it('down() drops both columns and the index with IF EXISTS', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new AddMemorySegmentSupersession20260707000000().down(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const dropColumns = statements.find((s) =>
      s.includes('ALTER TABLE memory_segments'),
    );
    expect(dropColumns).toBeDefined();
    expect(dropColumns).toMatch(/DROP COLUMN IF EXISTS supersedes/);
    expect(dropColumns).toMatch(/DROP COLUMN IF EXISTS superseded_by/);

    const dropIndex = statements.find((s) =>
      s.includes('DROP INDEX IF EXISTS idx_memory_segments_superseded_by'),
    );
    expect(dropIndex).toBeDefined();
  });

  it('is registered (prepended) in registered-migrations', async () => {
    const { registeredMigrations } = await import('./registered-migrations.js');
    const names = registeredMigrations.map((m: { name: string }) => m.name);
    expect(names).toContain('AddMemorySegmentSupersession20260707000000');
  });
});
