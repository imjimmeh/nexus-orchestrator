import { describe, it, expect } from 'vitest';
import { buildSeedRoles } from './roles.seed';
import {
  RESOURCES,
  resourceAdminRoleName,
  MEMBER_ADMIN_ROLE_NAME,
} from '../../../auth/authorization/permission-catalog';

describe('buildSeedRoles', () => {
  const names = buildSeedRoles().map((r) => r.name);

  it('keeps the broad roles and renames org_admin to tenant_admin', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'platform_admin',
        'tenant_admin',
        'member',
        'viewer',
      ]),
    );
    expect(names).not.toContain('org_admin');
  });

  it('includes one <resource>_admin role per catalog resource', () => {
    for (const resource of RESOURCES) {
      expect(names).toContain(resourceAdminRoleName(resource));
    }
  });

  it('includes the member_admin composite role', () => {
    expect(names).toContain(MEMBER_ADMIN_ROLE_NAME);
  });

  it('produces no duplicate role names', () => {
    expect(new Set(names).size).toBe(names.length);
  });
});
