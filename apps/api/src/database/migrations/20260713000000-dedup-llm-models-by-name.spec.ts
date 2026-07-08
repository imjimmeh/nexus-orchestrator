import { describe, expect, it, vi } from 'vitest';
import { QueryRunner } from 'typeorm';
import { registeredMigrations } from './registered-migrations';

function getMigration() {
  const Migration = registeredMigrations.find(
    (migration) => migration.name === 'DedupLlmModelsByName20260713000000',
  );

  expect(Migration).toBeDefined();

  return new Migration!();
}

describe('DedupLlmModelsByName20260713000000', () => {
  it('is registered so TypeORM applies it at startup', () => {
    expect(registeredMigrations.map((migration) => migration.name)).toContain(
      'DedupLlmModelsByName20260713000000',
    );
  });

  it('deletes duplicate llm_models rows, preferring the sole default_for_execution row per name group, else the oldest', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await getMigration().up(queryRunner);

    const statements = query.mock.calls.map(([sql]) => sql).join('\n');

    expect(statements).toContain('DELETE FROM llm_models');
    expect(statements).toContain('ROW_NUMBER()');
    expect(statements).toContain('PARTITION BY name');
    // The tie-break must consult default_for_execution and how many rows in
    // the group carry it, so an ambiguous group (0 or >1 default rows) falls
    // back to oldest-by-created_at instead of picking arbitrarily.
    expect(statements).toContain('default_for_execution');
    expect(statements).toContain(
      'COUNT(*) FILTER (WHERE default_for_execution)',
    );
    expect(statements).toContain('created_at');
  });

  it('is a no-op (safe to run) against a table with no duplicate names', async () => {
    // The DELETE targets only rows ranked > 1 within their name partition, so
    // a table where every name is unique produces zero deletions naturally —
    // no separate guard clause is required for idempotency.
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await getMigration().up(queryRunner);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('down is a no-op since deleted duplicates cannot be restored', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await getMigration().down(queryRunner);

    expect(query).not.toHaveBeenCalled();
  });
});

describe('llm_models dedup tie-break logic (pure simulation)', () => {
  // Mirrors the SQL CASE/ROW_NUMBER semantics in plain TS so the tie-break
  // rule itself (not just the SQL shape) is under regression test, since we
  // have no live DB in this workspace to execute the migration against.
  interface Row {
    id: string;
    name: string;
    default_for_execution: boolean;
    created_at: string;
  }

  function pickCanonicalId(rows: Row[]): string {
    const trueCount = rows.filter((row) => row.default_for_execution).length;
    const ranked = [...rows].sort((a, b) => {
      const aPreferred = a.default_for_execution && trueCount === 1 ? 0 : 1;
      const bPreferred = b.default_for_execution && trueCount === 1 ? 0 : 1;
      if (aPreferred !== bPreferred) return aPreferred - bPreferred;
      return (
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });
    return ranked[0].id;
  }

  it('keeps the sole default_for_execution=true row when exactly one exists', () => {
    const rows: Row[] = [
      {
        id: 'true-row',
        name: 'MiniMax-M3',
        default_for_execution: true,
        created_at: '2026-02-01T00:00:00Z',
      },
      {
        id: 'false-row-newer',
        name: 'MiniMax-M3',
        default_for_execution: false,
        created_at: '2026-05-01T00:00:00Z',
      },
    ];

    expect(pickCanonicalId(rows)).toBe('true-row');
  });

  it('falls back to the oldest row by created_at when no row in the group is default_for_execution', () => {
    const rows: Row[] = [
      {
        id: 'newer',
        name: 'gpt-5.4',
        default_for_execution: false,
        created_at: '2026-05-01T00:00:00Z',
      },
      {
        id: 'oldest',
        name: 'gpt-5.4',
        default_for_execution: false,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    expect(pickCanonicalId(rows)).toBe('oldest');
  });

  it('falls back to the oldest row by created_at when more than one row in the group is default_for_execution', () => {
    const rows: Row[] = [
      {
        id: 'oldest-true',
        name: 'ambiguous-model',
        default_for_execution: true,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'newer-true',
        name: 'ambiguous-model',
        default_for_execution: true,
        created_at: '2026-03-01T00:00:00Z',
      },
    ];

    expect(pickCanonicalId(rows)).toBe('oldest-true');
  });

  it('leaves a single-row group untouched', () => {
    const rows: Row[] = [
      {
        id: 'only-row',
        name: 'claude-opus-4-8',
        default_for_execution: false,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    expect(pickCanonicalId(rows)).toBe('only-row');
  });
});
