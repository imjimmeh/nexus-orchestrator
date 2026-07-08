import { describe, expect, it, vi } from 'vitest';
import { QueryRunner } from 'typeorm';
import { AddLearningCandidateRoutingTarget20260705000000 } from './20260705000000-add-learning-candidate-routing-target';

describe('AddLearningCandidateRoutingTarget20260705000000', () => {
  it('up() adds routing_target varchar(24) with IF NOT EXISTS (idempotent)', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new AddLearningCandidateRoutingTarget20260705000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const alter = statements.find((s) =>
      s.includes('ALTER TABLE learning_candidates'),
    );
    expect(alter).toBeDefined();
    expect(alter).toMatch(/ADD COLUMN IF NOT EXISTS routing_target/);
    expect(alter).toMatch(/varchar\(24\)/);
  });

  it('up() creates idx_learning_candidates_routing_target with IF NOT EXISTS', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new AddLearningCandidateRoutingTarget20260705000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    const index = statements.find((s) =>
      s.includes('idx_learning_candidates_routing_target'),
    );
    expect(index).toBeDefined();
    expect(index).toMatch(/CREATE INDEX IF NOT EXISTS/);
    expect(index).toMatch(/learning_candidates \(routing_target\)/);
  });

  it('down() drops the index then the column (both IF EXISTS)', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new AddLearningCandidateRoutingTarget20260705000000().down(
      queryRunner,
    );

    const statements = query.mock.calls.map(([statement]) => statement);
    const dropIndex = statements.find((s) =>
      s.includes('DROP INDEX IF EXISTS idx_learning_candidates_routing_target'),
    );
    const dropColumn = statements.find((s) =>
      s.includes('DROP COLUMN IF EXISTS routing_target'),
    );
    expect(dropIndex).toBeDefined();
    expect(dropColumn).toBeDefined();
  });

  it('is registered (prepended) in registered-migrations', async () => {
    const { registeredMigrations } = await import('./registered-migrations.js');
    const names = registeredMigrations.map((m: { name: string }) => m.name);
    expect(names).toContain('AddLearningCandidateRoutingTarget20260705000000');
  });
});
