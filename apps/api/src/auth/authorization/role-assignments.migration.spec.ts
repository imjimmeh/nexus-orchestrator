import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('create-role-assignments migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../database/migrations/20260609020000-create-role-assignments.ts',
    ),
    'utf8',
  );

  it('creates the role_assignments table idempotently', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS role_assignments');
    expect(sql).toContain(
      'scope_node_id uuid NOT NULL REFERENCES scope_nodes(id)',
    );
  });

  it('adds the nullable owner_scope_node_id column to roles', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS owner_scope_node_id uuid');
  });

  it('backfills user_roles into role_assignments at the global root', () => {
    expect(sql).toContain('INSERT INTO role_assignments');
    expect(sql).toContain('FROM user_roles');
    expect(sql).toContain('00000000-0000-0000-0000-000000000000');
    expect(sql).toContain('ON CONFLICT');
  });

  it('has a guarded down()', () => {
    expect(sql).toContain('public async down');
    expect(sql).toContain('Rollback');
  });
});
