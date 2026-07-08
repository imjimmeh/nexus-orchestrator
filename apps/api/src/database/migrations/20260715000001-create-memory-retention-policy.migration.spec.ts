import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('create-memory-retention-policy migration', () => {
  const sql = readFileSync(
    join(__dirname, '20260715000001-create-memory-retention-policy.ts'),
    'utf8',
  );

  it('creates the memory_retention_policy table idempotently', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS memory_retention_policy');
  });

  it('declares the singleton CHECK constraint by name and shape', () => {
    expect(sql).toContain('memory_retention_policy_singleton_check');
    expect(sql).toMatch(/CHECK\s*\(\s*"id"\s*=\s*1\s*\)/);
  });

  it('declares the four policy columns with their documented types', () => {
    // `id` may be declared with or without an inline `PRIMARY KEY`
    // (e.g. as a column constraint vs. a table-level constraint)
    // and `sample_size` may be expressed as `integer` or the
    // `int` alias, so we assert the loose substrings.
    expect(sql).toContain('"id" smallint');
    expect(sql).toContain('PRIMARY KEY');
    expect(sql).toContain('"usefulness_threshold" numeric');
    expect(sql).toContain('"recalibrated_at" timestamptz');
    expect(sql).toMatch(/"sample_size"\s+(?:integer|int)\b/);
  });

  it('seeds the singleton idempotently with the canonical default threshold', () => {
    expect(sql).toContain('INSERT INTO memory_retention_policy');
    expect(sql).toContain('ON CONFLICT ("id") DO NOTHING');

    // The seed must derive the default from the canonical constant
    // so a future re-tuning of the threshold flows through the
    // migration without a SQL edit.
    expect(sql).toContain('MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT');
  });

  it('cross-checks that the canonical default equals 0.6', () => {
    // The seed's value is sourced from the settings constants
    // module, so the spec pins the expected default (0.6) by
    // reading the constant file alongside the migration. This
    // guards against a silent constant change that would shift
    // every fresh database's policy row.
    const constants = readFileSync(
      join(
        __dirname,
        '../../settings/memory-decay-value.settings.constants.ts',
      ),
      'utf8',
    );
    expect(constants).toMatch(
      /MEMORY_DECAY_USEFULNESS_THRESHOLD_DEFAULT\s*=\s*0\.6\b/,
    );
  });

  it('drops the table in down()', () => {
    expect(sql).toContain('public async down');
    expect(sql).toContain('DROP TABLE IF EXISTS memory_retention_policy');
  });
});
