import { describe, expect, it, vi } from 'vitest';
import { QueryRunner } from 'typeorm';
import { registeredMigrations } from './registered-migrations';

function getMigration() {
  const Migration = registeredMigrations.find(
    (migration) =>
      migration.name === 'CreateCostGovernanceTables20260604130000',
  );

  expect(Migration).toBeDefined();

  return new Migration!();
}

describe('CreateCostGovernanceTables20260604130000', () => {
  it('creates the cost governance tables required by registered entities', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await getMigration().up(queryRunner);

    const joinedStatements = query.mock.calls
      .map(([statement]) => statement)
      .join('\n');

    expect(joinedStatements).toContain(
      'CREATE TABLE IF NOT EXISTS budget_policies',
    );
    expect(joinedStatements).toContain(
      'CREATE TABLE IF NOT EXISTS budget_decision_events',
    );
    expect(joinedStatements).toContain(
      'CREATE TABLE IF NOT EXISTS budget_usage_events',
    );
  });

  it('is registered so TypeORM applies it at startup', () => {
    expect(registeredMigrations.map((migration) => migration.name)).toContain(
      'CreateCostGovernanceTables20260604130000',
    );
  });

  it('quotes the budget policy window column because it is a PostgreSQL keyword', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await getMigration().up(queryRunner);

    const budgetPoliciesStatement = query.mock.calls
      .map(([statement]) => statement)
      .find((statement) =>
        statement.includes('CREATE TABLE IF NOT EXISTS budget_policies'),
      );

    expect(budgetPoliciesStatement).toBeDefined();
    expect(budgetPoliciesStatement).toContain(
      '"window" character varying(32) NOT NULL',
    );
    expect(budgetPoliciesStatement).not.toMatch(
      /^\s*window character varying\(32\) NOT NULL,/m,
    );
  });
});
