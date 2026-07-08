import { describe, expect, it, vi } from 'vitest';
import { AddScopeNodeIsTenantRoot20260714000000 } from './20260714000000-add-scope-node-is-tenant-root';

describe('AddScopeNodeIsTenantRoot migration', () => {
  it('adds a non-null is_tenant_root column defaulting to false', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await new AddScopeNodeIsTenantRoot20260714000000().up({ query } as never);
    const sql = query.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sql).toContain(
      '"scope_nodes" ADD COLUMN IF NOT EXISTS "is_tenant_root"',
    );
    expect(sql).toContain('boolean');
    expect(sql).toContain('NOT NULL');
    expect(sql).toContain('DEFAULT false');
  });

  it('drops the column in down()', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await new AddScopeNodeIsTenantRoot20260714000000().down({ query } as never);
    const sql = query.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sql).toContain(
      '"scope_nodes" DROP COLUMN IF EXISTS "is_tenant_root"',
    );
  });
});
