import { describe, expect, it, vi } from 'vitest';
import { QueryRunner } from 'typeorm';
import { CreateSignalWeightHistory20260708000000 } from './20260708000000-create-signal-weight-history';

describe('CreateSignalWeightHistory20260708000000', () => {
  it('up() issues CREATE TABLE IF NOT EXISTS signal_weight_history', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateSignalWeightHistory20260708000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const createTable = statements.find((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS signal_weight_history'),
    );
    expect(createTable).toBeDefined();
  });

  it('up() defines the versioning + audit columns', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateSignalWeightHistory20260708000000().up(queryRunner);

    const createTable = query.mock.calls
      .map(([statement]) => statement)
      .find((s) =>
        s.includes('CREATE TABLE IF NOT EXISTS signal_weight_history'),
      );
    expect(createTable).toBeDefined();
    expect(createTable).toMatch(/"weights_json"\s+jsonb\s+NOT NULL/);
    expect(createTable).toMatch(/"previous_weights_json"\s+jsonb/);
    expect(createTable).toMatch(/"training_sample_size"\s+int\s+NOT NULL/);
    expect(createTable).toMatch(/"bounded_delta"\s+double precision/);
    expect(createTable).toMatch(/"applied"\s+boolean\s+NOT NULL DEFAULT false/);
    expect(createTable).toMatch(/"reason"\s+varchar\(64\)/);
    expect(createTable).toMatch(/"created_at"\s+timestamptz\s+NOT NULL/);
  });

  it('down() drops the table with IF EXISTS', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateSignalWeightHistory20260708000000().down(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const dropTable = statements.find((s) =>
      s.includes('DROP TABLE IF EXISTS signal_weight_history'),
    );
    expect(dropTable).toBeDefined();
  });

  it('is registered (prepended) in registered-migrations', async () => {
    const { registeredMigrations } = await import('./registered-migrations.js');
    const names = registeredMigrations.map((m: { name: string }) => m.name);
    expect(names).toContain('CreateSignalWeightHistory20260708000000');
  });
});
