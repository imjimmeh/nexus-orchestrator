import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('create-invitations migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../database/migrations/20260714020000-create-invitations.ts',
    ),
    'utf8',
  );

  it('creates the invitations table idempotently', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS invitations');
    expect(sql).toContain(
      'scope_node_id uuid NOT NULL REFERENCES scope_nodes(id)',
    );
    expect(sql).toContain('role_id uuid NOT NULL REFERENCES roles(id)');
    expect(sql).toContain(
      'invited_by_user_id uuid NOT NULL REFERENCES users(id)',
    );
    expect(sql).toContain("status varchar(16) NOT NULL DEFAULT 'pending'");
  });

  it('creates a unique index on token_hash', () => {
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_token_hash ON invitations (token_hash)',
    );
  });

  it('creates supporting indexes on scope_node_id and status', () => {
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_invitations_scope ON invitations (scope_node_id)',
    );
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations (status)',
    );
  });

  it('drops the table in down()', () => {
    expect(sql).toContain('public async down');
    expect(sql).toContain('DROP TABLE IF EXISTS invitations');
  });
});
