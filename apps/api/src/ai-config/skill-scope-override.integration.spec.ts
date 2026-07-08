import { describe, it, expect, vi } from 'vitest';
import { SkillService } from './services/skill.service';
import { GLOBAL_SCOPE_NODE_ID } from '../scope/scope.constants';

describe('Skill scope override resolution', () => {
  it('resolves scoped skill over default', async () => {
    const scopedResult = {
      objectType: 'skill',
      name: 'code-review',
      scopeNodeId: 'project-1',
      value: {
        id: 'scoped-id',
        name: 'code-review',
        skill_markdown: '# Scoped',
        scope_node_id: 'project-1',
      },
      contributingLayers: [
        {
          rowId: 'default-id',
          scopeNodeId: null,
          source: 'imported',
          strategy: 'replace',
        },
        {
          rowId: 'scoped-id',
          scopeNodeId: 'project-1',
          source: 'admin',
          strategy: 'replace',
        },
      ],
      isDefault: false,
      locked: false,
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(scopedResult),
    } as any;
    const repo = {} as any;
    const svc = new SkillService(resolver, repo);

    const result = await svc.resolve('code-review', 'project-1');

    expect(result.value).toMatchObject({ scope_node_id: 'project-1' });
    expect(result.isDefault).toBe(false);
    expect(resolver.resolve).toHaveBeenCalledWith(
      'skill',
      'code-review',
      'project-1',
    );
  });

  it('resolves default skill when no scoped override', async () => {
    const defaultResult = {
      objectType: 'skill',
      name: 'code-review',
      scopeNodeId: GLOBAL_SCOPE_NODE_ID,
      value: {
        id: 'default-id',
        name: 'code-review',
        skill_markdown: '# Default',
        scope_node_id: null,
      },
      contributingLayers: [
        {
          rowId: 'default-id',
          scopeNodeId: null,
          source: 'imported',
          strategy: 'replace',
        },
      ],
      isDefault: true,
      locked: false,
    };
    const resolver = {
      resolve: vi.fn().mockResolvedValue(defaultResult),
    } as any;
    const repo = {} as any;
    const svc = new SkillService(resolver, repo);

    const result = await svc.resolve('code-review', 'different-project');
    expect(result.isDefault).toBe(true);
  });

  it('createScopedOverride throws NotFoundException if base skill not found', async () => {
    const resolver = {} as any;
    const repo = {
      findOne: vi.fn().mockResolvedValue(null),
      save: vi.fn(),
      create: vi.fn(),
    } as any;
    const svc = new SkillService(resolver, repo);
    await expect(
      svc.createScopedOverride('nonexistent', 'proj', '# content'),
    ).rejects.toThrow('not found');
  });
});
