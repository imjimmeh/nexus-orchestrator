import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ScopeService } from './scope.service';
import { GLOBAL_SCOPE_NODE_ID } from './scope.constants';

describe('ScopeService.updateNode', () => {
  it('renames a node and sets isTenantRoot on an org node', async () => {
    const node = {
      id: 'org-1',
      type: 'org',
      name: 'Old',
      isTenantRoot: false,
    };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn(async (n: unknown) => n),
    };
    const dataSource = {} as any;
    const service = new ScopeService(nodeRepo as any, dataSource);

    const result = await service.updateNode('org-1', {
      name: 'New',
      isTenantRoot: true,
    });

    expect(result.name).toBe('New');
    expect(result.isTenantRoot).toBe(true);
    expect(nodeRepo.save).toHaveBeenCalledTimes(1);
  });

  it('rejects updates to the immutable global root node', async () => {
    const nodeRepo = {
      findOneBy: vi.fn(),
      save: vi.fn(),
    };
    const dataSource = {} as any;
    const service = new ScopeService(nodeRepo as any, dataSource);

    await expect(
      service.updateNode(GLOBAL_SCOPE_NODE_ID, { name: 'x' }),
    ).rejects.toThrow(BadRequestException);
    expect(nodeRepo.save).not.toHaveBeenCalled();
  });

  it('rejects isTenantRoot:true on a non-org/platform node type', async () => {
    const node = {
      id: 'team-1',
      type: 'team',
      name: 'Team',
      isTenantRoot: false,
    };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn(async (n: unknown) => n),
    };
    const dataSource = {} as any;
    const service = new ScopeService(nodeRepo as any, dataSource);

    await expect(
      service.updateNode('team-1', { isTenantRoot: true }),
    ).rejects.toThrow(BadRequestException);
    expect(nodeRepo.save).not.toHaveBeenCalled();
  });

  it('allows renaming a team node without touching isTenantRoot', async () => {
    const node = {
      id: 'team-1',
      type: 'team',
      name: 'Team',
      isTenantRoot: false,
    };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn(async (n: unknown) => n),
    };
    const dataSource = {} as any;
    const service = new ScopeService(nodeRepo as any, dataSource);

    const result = await service.updateNode('team-1', { name: 'x' });

    expect(result.name).toBe('x');
    expect(result.isTenantRoot).toBe(false);
    expect(nodeRepo.save).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown node id with NotFoundException', async () => {
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(null),
      save: vi.fn(),
    };
    const dataSource = {} as any;
    const service = new ScopeService(nodeRepo as any, dataSource);

    await expect(
      service.updateNode('missing-id', { name: 'x' }),
    ).rejects.toThrow(NotFoundException);
    expect(nodeRepo.save).not.toHaveBeenCalled();
  });

  it('applies only the provided fields, leaving others untouched', async () => {
    const node = {
      id: 'org-1',
      type: 'org',
      name: 'Old',
      slug: 'old-slug',
      isTenantRoot: true,
    };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn(async (n: unknown) => n),
    };
    const dataSource = {} as any;
    const service = new ScopeService(nodeRepo as any, dataSource);

    const result = await service.updateNode('org-1', { name: 'New' });

    expect(result.name).toBe('New');
    expect(result.slug).toBe('old-slug');
    expect(result.isTenantRoot).toBe(true);
  });

  it('records a scope-updated audit event with actorId, changed fields, and previous/next values', async () => {
    const node = {
      id: 'org-1',
      type: 'org',
      name: 'Old',
      isTenantRoot: false,
    };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn(async (n: unknown) => n),
    };
    const dataSource = {} as any;
    const authzAudit = {
      recordScopeUpdated: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ScopeService(
      nodeRepo as any,
      dataSource,
      authzAudit as any,
    );

    await service.updateNode('org-1', {
      name: 'New',
      isTenantRoot: true,
      actorId: 'actor-1',
    });

    expect(authzAudit.recordScopeUpdated).toHaveBeenCalledWith({
      actorId: 'actor-1',
      scopeNodeId: 'org-1',
      changedFields: ['name', 'isTenantRoot'],
      previous: { name: 'Old', isTenantRoot: false },
      next: { name: 'New', isTenantRoot: true },
    });
  });

  it('defaults the audit actorId to "system" when no actorId is provided', async () => {
    const node = {
      id: 'org-1',
      type: 'org',
      name: 'Old',
      isTenantRoot: false,
    };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn(async (n: unknown) => n),
    };
    const dataSource = {} as any;
    const authzAudit = {
      recordScopeUpdated: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ScopeService(
      nodeRepo as any,
      dataSource,
      authzAudit as any,
    );

    await service.updateNode('org-1', { name: 'New' });

    expect(authzAudit.recordScopeUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'system' }),
    );
  });

  it('does not record an audit event when no fields actually change', async () => {
    const node = {
      id: 'org-1',
      type: 'org',
      name: 'Old',
      isTenantRoot: false,
    };
    const nodeRepo = {
      findOneBy: vi.fn().mockResolvedValue(node),
      save: vi.fn(async (n: unknown) => n),
    };
    const dataSource = {} as any;
    const authzAudit = {
      recordScopeUpdated: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ScopeService(
      nodeRepo as any,
      dataSource,
      authzAudit as any,
    );

    await service.updateNode('org-1', {});

    expect(authzAudit.recordScopeUpdated).not.toHaveBeenCalled();
  });
});
