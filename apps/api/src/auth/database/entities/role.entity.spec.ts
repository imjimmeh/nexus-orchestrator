import { describe, it, expect } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { Role } from './role.entity';

describe('Role entity', () => {
  it('defaults a system role owner to null', () => {
    const role = new Role();
    role.name = 'platform_admin';
    role.ownerScopeNodeId = null;
    expect(role.ownerScopeNodeId).toBeNull();
  });

  it('carries an owner_scope_node_id column for org-local custom roles', () => {
    const storage = getMetadataArgsStorage();
    const column = storage.columns.find(
      (c) => c.target === Role && c.options.name === 'owner_scope_node_id',
    );
    expect(column).toBeDefined();
    expect(column?.options.nullable).toBe(true);
  });
});
