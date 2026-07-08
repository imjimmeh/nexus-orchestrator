import { describe, it, expect } from 'vitest';
import { buildRolePermissionMappings } from './role-permissions.seed';
import {
  RESOURCES,
  resourceAdminRoleName,
  permissionName,
  MEMBER_ADMIN_ROLE_NAME,
} from '../../../auth/authorization/permission-catalog';

describe('buildRolePermissionMappings', () => {
  const mappings = buildRolePermissionMappings();

  it('maps tenant_admin (renamed from org_admin) and drops org_admin', () => {
    expect(mappings.tenant_admin).toBeDefined();
    expect(mappings.org_admin).toBeUndefined();
    expect(mappings.tenant_admin).toContain(permissionName('roles', 'manage'));
  });

  it('grants each <resource>_admin exactly <resource>:manage', () => {
    for (const resource of RESOURCES) {
      expect(mappings[resourceAdminRoleName(resource)]).toEqual([
        permissionName(resource, 'manage'),
      ]);
    }
  });

  it('grants member_admin roles:manage and users:manage', () => {
    expect(mappings[MEMBER_ADMIN_ROLE_NAME]).toEqual(
      expect.arrayContaining([
        permissionName('roles', 'manage'),
        permissionName('users', 'manage'),
      ]),
    );
  });
});
