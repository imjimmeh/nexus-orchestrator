import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('gitops repository bindings migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../database/migrations/20260611120000-create-gitops-repository-bindings.ts',
    ),
    'utf8',
  );

  it('creates binding, run, and pending-change tables', () => {
    expect(sql).toContain('gitops_repository_bindings');
    expect(sql).toContain('gitops_reconcile_runs');
    expect(sql).toContain('gitops_pending_changes');
  });

  it('stores sync mode and included object types', () => {
    expect(sql).toContain('sync_mode');
    expect(sql).toContain('included_object_types');
  });
});
