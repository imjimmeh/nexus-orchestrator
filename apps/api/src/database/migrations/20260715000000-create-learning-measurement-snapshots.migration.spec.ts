import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('create-learning-measurement-snapshots migration', () => {
  const sql = readFileSync(
    join(__dirname, '20260715000000-create-learning-measurement-snapshots.ts'),
    'utf8',
  );

  it('creates the learning_measurement_snapshots table idempotently', () => {
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS learning_measurement_snapshots',
    );
  });

  it('declares the six snapshot columns with their documented types', () => {
    // `source_window` is asserted via a regex so the test tolerates
    // either the compact `varchar(8)` or the spaced `varchar( 8 )`
    // form a future reformatting might emit.
    expect(sql).toContain('"computed_at" timestamptz');
    expect(sql).toMatch(/"source_window"\s+varchar\(\s*8\s*\)/);
    expect(sql).toContain('"promoted_to_bound_score" numeric');
    expect(sql).toContain('"bound_to_reused_score" numeric');
    expect(sql).toContain('"usefulness_histogram" jsonb');
    expect(sql).toContain('"retention_decision_distribution" jsonb');
  });

  it('creates the computed_at descending index', () => {
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS learning_measurement_snapshots_computed_at_idx',
    );
  });

  it('drops the index and the table in down()', () => {
    expect(sql).toContain('public async down');
    expect(sql).toContain('DROP INDEX IF EXISTS');
    expect(sql).toContain(
      'DROP TABLE IF EXISTS learning_measurement_snapshots',
    );
  });
});
