import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(__dirname, '20260610000000-add-config-override-columns.ts'),
  'utf8',
);

describe('add-config-override-columns migration', () => {
  it('adds override columns to workflows', () => {
    expect(sql).toContain('ALTER TABLE workflows');
    expect(sql).toContain('scope_node_id');
    expect(sql).toContain('source character varying');
    expect(sql).toContain('locked boolean NOT NULL DEFAULT false');
    expect(sql).toContain('overrides jsonb');
    expect(sql).toContain('base_ref uuid');
  });

  it('adds the missing override columns to agent_profiles', () => {
    expect(sql).toContain('ALTER TABLE agent_profiles');
    expect(sql).toContain('scope_node_id');
    expect(sql).toContain('locked boolean NOT NULL DEFAULT false');
  });

  it('enforces one default row per name via a partial unique index', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX');
    expect(sql).toMatch(/WHERE\s+scope_node_id IS NULL/i);
  });

  it('has a guarded down() that refuses to drop columns while scoped rows exist', () => {
    expect(sql).toContain('public async down');
    expect(sql).toMatch(/scope_node_id IS NOT NULL/i);
    expect(sql).toContain('Rollback');
  });
});
