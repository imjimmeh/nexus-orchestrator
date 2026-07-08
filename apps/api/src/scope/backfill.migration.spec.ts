import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('backfill-scope-nodes migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../database/migrations/20260609010000-backfill-scope-nodes.ts',
    ),
    'utf8',
  );
  it('reuses scope_id as node id and parents to the global root', () => {
    expect(sql).toContain('INSERT INTO scope_nodes');
    expect(sql).toContain("'project'");
    expect(sql).toContain('00000000-0000-0000-0000-000000000000');
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
  });
  it('builds closure rows for backfilled nodes', () => {
    expect(sql).toContain('scope_node_closure');
  });
});
