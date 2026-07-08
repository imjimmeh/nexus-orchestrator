import { describe, it, expect, vi } from 'vitest';
import { ScopeController } from './scope.controller';

const fakeReq = (userId = 'user-1') => ({
  user: { userId, email: 'u@example.com', roles: [] },
});

describe('ScopeController.create', () => {
  it('wraps createNode result in a success envelope', async () => {
    const service = {
      createNode: vi.fn().mockResolvedValue({ id: 'n1' }),
    } as any;
    const controller = new ScopeController(service);
    const result = await controller.create({
      parentId: null,
      type: 'org',
      name: 'Acme',
      slug: 'acme',
    });
    expect(service.createNode).toHaveBeenCalledWith({
      parentId: null,
      type: 'org',
      name: 'Acme',
      slug: 'acme',
    });
    expect(result).toEqual({ success: true, data: { id: 'n1' } });
  });
});

describe('ScopeController.ensure', () => {
  it('wraps ensureNode result in a success envelope', async () => {
    const existing = {
      id: 'proj-uuid',
      type: 'project',
      name: 'Web App',
      slug: 'web-app',
      parentId: null,
    };
    const service = { ensureNode: vi.fn().mockResolvedValue(existing) } as any;
    const controller = new ScopeController(service);
    const result = await controller.ensure({
      id: 'proj-uuid',
      parentId: null,
      type: 'project',
      name: 'Web App',
      slug: 'web-app',
    });
    expect(service.ensureNode).toHaveBeenCalledWith({
      id: 'proj-uuid',
      parentId: null,
      type: 'project',
      name: 'Web App',
      slug: 'web-app',
    });
    expect(result).toEqual({ success: true, data: existing });
  });
});

describe('ScopeController.getTree', () => {
  it('passes req.user.userId to scopeService.getTree and wraps result', async () => {
    const tree = { id: 'root', parentId: null, children: [] };
    const service = { getTree: vi.fn().mockResolvedValue(tree) } as any;
    const controller = new ScopeController(service);

    const result = await controller.getTree(fakeReq('user-42'));

    expect(service.getTree).toHaveBeenCalledWith('user-42');
    expect(result).toEqual({ success: true, data: tree });
  });
});

describe('ScopeController.moveNode', () => {
  it('delegates to scopeService.moveNode with the requesting actor id', async () => {
    const service = { moveNode: vi.fn().mockResolvedValue(undefined) } as any;
    const controller = new ScopeController(service);
    const result = await controller.moveNode(
      'n1',
      { newParentId: 'n2' },
      fakeReq('actor-7'),
    );
    expect(service.moveNode).toHaveBeenCalledWith('n1', 'n2', 'actor-7');
    expect(result).toEqual({ success: true });
  });
});

describe('ScopeController.update', () => {
  it('delegates to scopeService.updateNode with the requesting actor id and wraps result', async () => {
    const updated = { id: 'n1', name: 'New' };
    const service = {
      updateNode: vi.fn().mockResolvedValue(updated),
    } as any;
    const controller = new ScopeController(service);

    const result = await controller.update(
      'n1',
      { name: 'New' },
      fakeReq('actor-1'),
    );

    expect(service.updateNode).toHaveBeenCalledWith('n1', {
      name: 'New',
      actorId: 'actor-1',
    });
    expect(result).toEqual({ success: true, data: updated });
  });
});

describe('ScopeController.getNode', () => {
  it('delegates to scopeService.getNode and wraps result', async () => {
    const node = { id: 'n1', type: 'org', name: 'Acme', slug: 'acme' };
    const service = {
      getNode: vi.fn().mockResolvedValue(node),
    } as any;
    const controller = new ScopeController(service);

    const result = await controller.getNode('n1');

    expect(service.getNode).toHaveBeenCalledWith('n1');
    expect(result).toEqual({ success: true, data: node });
  });
});

describe('ScopeController.allowedChildTypes', () => {
  it('delegates to scopeService.getAllowedChildTypes and wraps result', async () => {
    const service = {
      getAllowedChildTypes: vi.fn().mockResolvedValue(['team', 'project']),
    } as any;
    const controller = new ScopeController(service);

    const result = await controller.allowedChildTypes('n1');

    expect(service.getAllowedChildTypes).toHaveBeenCalledWith('n1');
    expect(result).toEqual({ success: true, data: ['team', 'project'] });
  });
});

describe('ScopeController.getOrphans', () => {
  it('returns orphan list in success envelope', async () => {
    const orphans = [{ id: 'o1', type: 'project' }];
    const service = {
      findOrphanedProjectNodes: vi.fn().mockResolvedValue(orphans),
    } as any;
    const controller = new ScopeController(service);

    const result = await controller.getOrphans();

    expect(service.findOrphanedProjectNodes).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: orphans });
  });
});

describe('ScopeController.archiveNode', () => {
  it('calls archiveNode on the service with the requesting actor id and returns success', async () => {
    const service = {
      archiveNode: vi.fn().mockResolvedValue(undefined),
    } as any;
    const controller = new ScopeController(service);

    const result = await controller.archiveNode('proj-1', fakeReq('actor-9'));

    expect(service.archiveNode).toHaveBeenCalledWith('proj-1', 'actor-9');
    expect(result).toEqual({ success: true });
  });
});

describe('ScopeController.restoreNode', () => {
  it('calls restoreNode on the service with the requesting actor id and returns success', async () => {
    const service = {
      restoreNode: vi.fn().mockResolvedValue(undefined),
    } as any;
    const controller = new ScopeController(service);

    const result = await controller.restoreNode('proj-1', fakeReq('actor-9'));

    expect(service.restoreNode).toHaveBeenCalledWith('proj-1', 'actor-9');
    expect(result).toEqual({ success: true });
  });
});
