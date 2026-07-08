import { describe, it, expect } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { Invitation } from './invitation.entity';
import { InvitationStatus } from '../../invitation.status.types';

describe('Invitation entity', () => {
  it('maps to the invitations table with snake_case columns', () => {
    const storage = getMetadataArgsStorage();
    const table = storage.tables.find((t) => t.target === Invitation);
    expect(table?.name).toBe('invitations');

    const columns = storage.columns.filter((c) => c.target === Invitation);
    const byProperty = (name: string) =>
      columns.find((c) => c.propertyName === name);

    expect(byProperty('tokenHash')?.options.name).toBe('token_hash');
    expect(byProperty('scopeNodeId')?.options.name).toBe('scope_node_id');
    expect(byProperty('roleId')?.options.name).toBe('role_id');
    expect(byProperty('invitedByUserId')?.options.name).toBe(
      'invited_by_user_id',
    );
    expect(byProperty('expiresAt')?.options.name).toBe('expires_at');
    expect(byProperty('acceptedByUserId')?.options.name).toBe(
      'accepted_by_user_id',
    );
  });

  it('marks tokenHash as select:false so it is excluded from default queries', () => {
    const storage = getMetadataArgsStorage();
    const tokenHashColumn = storage.columns.find(
      (c) => c.target === Invitation && c.propertyName === 'tokenHash',
    );
    expect(tokenHashColumn?.options.select).toBe(false);
  });

  it('defaults status to pending', () => {
    const storage = getMetadataArgsStorage();
    const statusColumn = storage.columns.find(
      (c) => c.target === Invitation && c.propertyName === 'status',
    );
    expect(statusColumn?.options.default).toBe(InvitationStatus.Pending);
  });

  it('allows email and acceptedByUserId to be nullable', () => {
    const storage = getMetadataArgsStorage();
    const emailColumn = storage.columns.find(
      (c) => c.target === Invitation && c.propertyName === 'email',
    );
    const acceptedByColumn = storage.columns.find(
      (c) => c.target === Invitation && c.propertyName === 'acceptedByUserId',
    );
    expect(emailColumn?.options.nullable).toBe(true);
    expect(acceptedByColumn?.options.nullable).toBe(true);
  });
});
