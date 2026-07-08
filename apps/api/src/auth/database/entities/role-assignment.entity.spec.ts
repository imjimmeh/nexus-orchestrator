import { describe, it, expect } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { RoleAssignment } from './role-assignment.entity';

describe('RoleAssignment entity', () => {
  it('constructs with user, role, and scope node ids', () => {
    const ra = new RoleAssignment();
    ra.id = 'ra1';
    ra.userId = 'u1';
    ra.roleId = 'r1';
    ra.scopeNodeId = 's1';
    expect(ra.userId).toBe('u1');
    expect(ra.roleId).toBe('r1');
    expect(ra.scopeNodeId).toBe('s1');
  });

  it('maps to the role_assignments table with snake_case columns', () => {
    const storage = getMetadataArgsStorage();
    const table = storage.tables.find((t) => t.target === RoleAssignment);
    expect(table?.name).toBe('role_assignments');
    const columns = storage.columns
      .filter((c) => c.target === RoleAssignment)
      .map((c) => c.options.name);
    expect(columns).toContain('user_id');
    expect(columns).toContain('role_id');
    expect(columns).toContain('scope_node_id');
  });
});
