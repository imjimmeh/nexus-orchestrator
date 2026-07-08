import { describe, expect, it, vi } from 'vitest';
import { QueryRunner } from 'typeorm';
import { EnablePgvector20260701000000 } from './20260701000000-enable-pgvector';

describe('EnablePgvector20260701000000', () => {
  it('issues CREATE EXTENSION IF NOT EXISTS vector as the first statement', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new EnablePgvector20260701000000().up(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    expect(statements[0]).toBe('CREATE EXTENSION IF NOT EXISTS vector;');
  });

  it('down() issues DROP EXTENSION IF EXISTS vector', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new EnablePgvector20260701000000().down(queryRunner);

    const statements = query.mock.calls.map(([statement]) => statement);
    expect(statements[0]).toBe('DROP EXTENSION IF EXISTS vector;');
  });

  it('is registered so TypeORM applies it at startup', async () => {
    const { registeredMigrations } = await import('./registered-migrations');
    expect(registeredMigrations.map((m) => m.name)).toContain(
      'EnablePgvector20260701000000',
    );
  });
});
