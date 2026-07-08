import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SkillService } from './skill.service';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';

describe('SkillService.resolve', () => {
  it('delegates to ScopedConfigResolver with objectType=skill', async () => {
    const fakeResult = {
      objectType: 'skill',
      name: 'my-skill',
      scopeNodeId: 'proj-1',
      value: { id: 'override' },
      contributingLayers: [],
      isDefault: false,
      locked: false,
    };
    const resolver = { resolve: vi.fn().mockResolvedValue(fakeResult) } as any;
    const repo = {} as any;
    const svc = new SkillService(resolver, repo, undefined, undefined);
    const result = await svc.resolve('my-skill', 'proj-1');
    expect(resolver.resolve).toHaveBeenCalledWith(
      'skill',
      'my-skill',
      'proj-1',
    );
    expect(result).toBe(fakeResult);
  });

  it('uses GLOBAL_SCOPE_NODE_ID when scopeNodeId is null', async () => {
    const resolver = { resolve: vi.fn().mockResolvedValue({}) } as any;
    const repo = {} as any;
    const svc = new SkillService(resolver, repo, undefined, undefined);
    await svc.resolve('my-skill', null);
    expect(resolver.resolve).toHaveBeenCalledWith(
      'skill',
      'my-skill',
      GLOBAL_SCOPE_NODE_ID,
    );
  });
});

describe('SkillService GitOps edit policy', () => {
  it('blocks scoped skill overrides in git-to-app bound scopes', async () => {
    const resolver = { resolve: vi.fn() } as any;
    const repo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'base-skill',
        name: 'review',
        scope_node_id: null,
      }),
      create: vi.fn(),
      save: vi.fn(),
    } as any;
    const editPolicy = {
      evaluateCreate: vi.fn().mockResolvedValue({
        action: 'block',
        reason: 'GitOps git-to-app binding blocks app-side edits',
      }),
      assertAllowed: vi.fn().mockImplementation(() => {
        throw new BadRequestException('blocked');
      }),
    } as any;
    const pendingChanges = { recordConfigObjectChange: vi.fn() } as any;
    const svc = new SkillService(resolver, repo, editPolicy, pendingChanges);

    await expect(
      svc.createScopedOverride('review', 'scope-1', 'updated', 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repo.save).not.toHaveBeenCalled();
    expect(pendingChanges.recordConfigObjectChange).not.toHaveBeenCalled();
  });

  it('records pending outbound changes for two-way scoped skill overrides', async () => {
    const binding = { id: 'binding-1', lastAppliedRevision: 'rev-1' };
    const resolver = { resolve: vi.fn() } as any;
    const repo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'base-skill',
        name: 'review',
        skill_markdown: 'base',
        scope_node_id: null,
      }),
      create: vi.fn((data) => data),
      save: vi.fn().mockResolvedValue({ id: 'skill-1', name: 'review' }),
    } as any;
    const editPolicy = {
      evaluateCreate: vi.fn().mockResolvedValue({
        action: 'allow_with_pending_change',
        binding,
      }),
      assertAllowed: vi.fn().mockResolvedValue(undefined),
    } as any;
    const pendingChanges = { recordConfigObjectChange: vi.fn() } as any;
    const svc = new SkillService(resolver, repo, editPolicy, pendingChanges);

    await svc.createScopedOverride('review', 'scope-1', 'updated', 'user-1');

    expect(pendingChanges.recordConfigObjectChange).toHaveBeenCalledWith(
      expect.objectContaining({
        binding,
        objectType: 'skill',
        scopeNodeId: 'scope-1',
        name: 'review',
        changeType: 'create',
        payload: { skill_markdown: 'updated' },
        actorId: 'user-1',
      }),
    );
  });
});
