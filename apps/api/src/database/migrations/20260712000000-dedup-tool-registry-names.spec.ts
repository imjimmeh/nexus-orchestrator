import { describe, expect, it, vi } from 'vitest';
import { QueryRunner } from 'typeorm';
import { registeredMigrations } from './registered-migrations';

function getMigration() {
  const Migration = registeredMigrations.find(
    (migration) => migration.name === 'DedupToolRegistryNames20260712000000',
  );

  expect(Migration).toBeDefined();

  return new Migration!();
}

describe('DedupToolRegistryNames20260712000000', () => {
  it('is registered so TypeORM applies it at startup', () => {
    expect(registeredMigrations.map((migration) => migration.name)).toContain(
      'DedupToolRegistryNames20260712000000',
    );
  });

  it('deletes duplicate tool_registry rows keeping the newest by updated_at', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await getMigration().up(queryRunner);

    const statements = query.mock.calls.map(([sql]) => sql).join('\n');

    expect(statements).toContain('DELETE FROM tool_registry');
    expect(statements).toContain('ROW_NUMBER()');
    expect(statements).toContain('PARTITION BY name');
    expect(statements).toContain('ORDER BY updated_at DESC');
    expect(statements).toContain('created_at DESC');
  });

  it('down is a no-op since deleted duplicates cannot be restored', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await getMigration().down(queryRunner);

    expect(query).not.toHaveBeenCalled();
  });
});
