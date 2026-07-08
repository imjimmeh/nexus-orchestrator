import { describe, it, expect, vi } from 'vitest';
import { RenameOrgAdminToTenantAdmin20260714010000 } from './20260714010000-rename-org-admin-to-tenant-admin';

function makeRunner() {
  return { query: vi.fn().mockResolvedValue(undefined) } as never;
}

describe('RenameOrgAdminToTenantAdmin20260714010000', () => {
  it('renames org_admin to tenant_admin on up (guarded, idempotent)', async () => {
    const runner = makeRunner();
    await new RenameOrgAdminToTenantAdmin20260714010000().up(runner);
    const sql = (runner as unknown as { query: ReturnType<typeof vi.fn> }).query
      .mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE roles');
    expect(sql).toContain('tenant_admin');
    expect(sql).toContain("WHERE name = 'org_admin'");
  });

  it('reverses the rename on down', async () => {
    const runner = makeRunner();
    await new RenameOrgAdminToTenantAdmin20260714010000().down(runner);
    const sql = (runner as unknown as { query: ReturnType<typeof vi.fn> }).query
      .mock.calls[0][0] as string;
    expect(sql).toContain("WHERE name = 'tenant_admin'");
    expect(sql).toContain('org_admin');
  });
});
