import { describe, it, expect } from 'vitest';
import {
  PERMISSION_CATALOG,
  permissionName,
  RESOURCES,
  ACTIONS,
  resourceAdminRoleName,
  RESOURCE_ADMIN_ROLE_NAMES,
  MEMBER_ADMIN_ROLE_NAME,
} from './permission-catalog';

describe('permission catalog', () => {
  it('builds names as resource:action', () => {
    expect(permissionName('workflows', 'read')).toBe('workflows:read');
  });
  it('defines the fixed action vocabulary', () => {
    expect(ACTIONS).toEqual(['read', 'create', 'update', 'delete', 'manage']);
  });
  it('covers the governed resources', () => {
    for (const r of [
      'scopes',
      'resources',
      'workflows',
      'agents',
      'skills',
      'approvals',
      'goals',
      'memory',
      'secrets',
      'budgets',
      'roles',
      'users',
    ]) {
      expect(RESOURCES).toContain(r);
    }
  });
  it('emits a unique permission per resource×action', () => {
    const names = PERMISSION_CATALOG.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(RESOURCES.length * ACTIONS.length);
  });
});

describe('resource-admin role derivation', () => {
  it('names a resource-admin role as <resource>_admin', () => {
    expect(resourceAdminRoleName('workflows')).toBe('workflows_admin');
    expect(resourceAdminRoleName('secrets')).toBe('secrets_admin');
  });

  it('derives exactly one admin role per catalog resource', () => {
    expect(RESOURCE_ADMIN_ROLE_NAMES).toHaveLength(RESOURCES.length);
    expect(RESOURCE_ADMIN_ROLE_NAMES).toEqual(
      RESOURCES.map((r) => `${r}_admin`),
    );
  });

  it('defines the member_admin composite role name', () => {
    expect(MEMBER_ADMIN_ROLE_NAME).toBe('member_admin');
  });
});
