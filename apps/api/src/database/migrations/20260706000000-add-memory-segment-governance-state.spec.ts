import { describe, expect, it, vi } from 'vitest';
import { QueryRunner } from 'typeorm';
import { AddMemorySegmentGovernanceState20260706000000 } from './20260706000000-add-memory-segment-governance-state';

describe('AddMemorySegmentGovernanceState20260706000000', () => {
  it('up() adds governance_state varchar(24) with IF NOT EXISTS (idempotent)', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new AddMemorySegmentGovernanceState20260706000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const alter = statements.find((s) =>
      s.includes('ALTER TABLE memory_segments'),
    );
    expect(alter).toBeDefined();
    expect(alter).toMatch(/ADD COLUMN IF NOT EXISTS governance_state/);
    expect(alter).toMatch(/varchar\(24\)/);
  });

  it('down() drops the column with IF EXISTS', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new AddMemorySegmentGovernanceState20260706000000().down(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const dropColumn = statements.find((s) =>
      s.includes('DROP COLUMN IF EXISTS governance_state'),
    );
    expect(dropColumn).toBeDefined();
  });

  it('is registered (prepended) in registered-migrations', async () => {
    const { registeredMigrations } = await import('./registered-migrations.js');
    const names = registeredMigrations.map((m: { name: string }) => m.name);
    expect(names).toContain('AddMemorySegmentGovernanceState20260706000000');
  });
});
