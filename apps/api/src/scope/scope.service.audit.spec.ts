import { describe, it, expect, vi } from 'vitest';
import { ScopeService } from './scope.service';

describe('ScopeService audit', () => {
  it('records scope_created after creating a node', async () => {
    const nodeRepo = {
      query: vi.fn().mockResolvedValue([]),
    };
    const dataSource = {
      transaction: vi.fn(async (cb: any) => {
        await cb({
          query: vi.fn(async (sql: string) => {
            if (sql.includes('gen_random_uuid')) return [{ id: 'child-id' }];
            if (sql.includes('SELECT type FROM scope_nodes'))
              return [{ type: 'org' }]; // 'org' -> 'team' is a valid nesting
            return [];
          }),
        });
        return {
          id: 'child-id',
          parentId: 'parent',
          type: 'team',
          name: 'Eng',
          slug: 'eng',
        };
      }),
    };
    const audit = {
      recordScopeCreated: vi.fn().mockResolvedValue(undefined),
    } as any;
    const svc = new ScopeService(nodeRepo as any, dataSource as any, audit);
    await svc.createNode({
      parentId: 'parent',
      type: 'team',
      name: 'Eng',
      slug: 'eng',
      actorId: 'admin',
    });
    expect(audit.recordScopeCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin',
        parentId: 'parent',
        type: 'team',
      }),
    );
  });

  it('works without audit dependency (optional)', async () => {
    const dataSource = {
      transaction: vi.fn(async (cb: any) => {
        await cb({
          query: vi.fn(async (sql: string) => {
            if (sql.includes('gen_random_uuid')) return [{ id: 'x' }];
            if (sql.includes('SELECT type FROM scope_nodes'))
              return [{ type: 'platform' }]; // 'platform' -> 'org' is a valid nesting
            return [];
          }),
        });
        return {
          id: 'x',
          parentId: null,
          type: 'org',
          name: 'Acme',
          slug: 'acme',
        };
      }),
    };
    const svc = new ScopeService({} as any, dataSource as any);
    await expect(
      svc.createNode({
        parentId: null,
        type: 'org',
        name: 'Acme',
        slug: 'acme',
      }),
    ).resolves.toBeDefined();
  });
});
