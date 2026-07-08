import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('add-managed-by-tag migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../database/migrations/20260612000000-add-managed-by-tag.ts',
    ),
    'utf8',
  );
  it('adds managed_by to every reconciled table idempotently', () => {
    for (const table of [
      'scope_nodes',
      'roles',
      'role_assignments',
      'scope_config_overrides',
    ]) {
      expect(sql).toContain(table);
    }
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS managed_by');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS locked');
  });
  it('has a guarded down()', () => {
    expect(sql).toContain('public async down');
    expect(sql).toContain('DROP COLUMN IF EXISTS managed_by');
    expect(sql).toContain('DROP COLUMN IF EXISTS locked');
  });
});
