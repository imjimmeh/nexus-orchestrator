import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('create-scope-hierarchy migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../database/migrations/20260609000000-create-scope-hierarchy.ts',
    ),
    'utf8',
  );
  it('creates both tables idempotently', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS scope_nodes');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS scope_node_closure');
  });
  it('inserts the global root node', () => {
    expect(sql).toContain('00000000-0000-0000-0000-000000000000');
    expect(sql).toContain("'platform'");
  });
  it('has a guarded down()', () => {
    expect(sql).toContain('public async down');
  });
});
