import { describe, expect, it, vi } from 'vitest';
import { QueryRunner } from 'typeorm';
import { CreateRetrospectiveQueue20260704000000 } from './20260704000000-create-retrospective-queue';

describe('CreateRetrospectiveQueue20260704000000', () => {
  it('up() issues CREATE TABLE IF NOT EXISTS retrospective_queue', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateRetrospectiveQueue20260704000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const createTable = statements.find((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS retrospective_queue'),
    );
    expect(createTable).toBeDefined();
  });

  it('up() defines a nullable scope_id and jsonb signals_json defaulting to {}', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateRetrospectiveQueue20260704000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const createTable = statements.find((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS retrospective_queue'),
    );
    expect(createTable).toBeDefined();
    expect(createTable).toMatch(/"scope_id"\s+varchar\(160\)/);
    expect(createTable).not.toMatch(/"scope_id"\s+varchar\(160\)\s+NOT NULL/);
    expect(createTable).toMatch(/"signals_json"\s+jsonb\s+NOT NULL DEFAULT/);
  });

  it('up() creates a UNIQUE index on workflow_run_id (idempotent enqueue)', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateRetrospectiveQueue20260704000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const uniqueIndex = statements.find((s) =>
      s.includes('uq_retrospective_queue_workflow_run_id'),
    );
    expect(uniqueIndex).toBeDefined();
    expect(uniqueIndex).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/);
    expect(uniqueIndex).toMatch(/workflow_run_id/);
  });

  it('up() creates idx_retrospective_queue_status_priority ordered by interest_score DESC', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateRetrospectiveQueue20260704000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const drainIndex = statements.find((s) =>
      s.includes('idx_retrospective_queue_status_priority'),
    );
    expect(drainIndex).toBeDefined();
    expect(drainIndex).toMatch(/CREATE INDEX IF NOT EXISTS/);
    expect(drainIndex).toMatch(/"status"/);
    expect(drainIndex).toMatch(/"priority"/);
    expect(drainIndex).toMatch(/"interest_score"\s+DESC/);
  });

  it('down() issues DROP TABLE IF EXISTS retrospective_queue', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateRetrospectiveQueue20260704000000().down(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const dropTable = statements.find((s) =>
      s.includes('DROP TABLE IF EXISTS retrospective_queue'),
    );
    expect(dropTable).toBeDefined();
  });

  it('is registered (prepended) in registered-migrations', async () => {
    const { registeredMigrations } = await import('./registered-migrations.js');
    const names = registeredMigrations.map((m: { name: string }) => m.name);
    expect(names).toContain('CreateRetrospectiveQueue20260704000000');
  });
});
