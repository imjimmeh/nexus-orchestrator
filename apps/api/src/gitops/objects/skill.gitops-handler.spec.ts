import { describe, expect, it, vi } from 'vitest';

describe('SkillGitopsHandler', () => {
  it('reads skills from the scope subtree and serializes repository-managed rows', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM skills')) {
        return [
          {
            id: 'skill-1',
            name: 'search',
            description: 'Search the repo.',
            skill_markdown: '# Search\n',
            category: 'research',
            tags: 'search,repo',
            metadata: { audience: 'agent' },
            scope_node_id: 'child-scope-1',
            source: 'repository',
            locked: false,
            version: 3,
            is_active: true,
            overrides: { strategy: 'replace' },
            base_ref: null,
            managed_by: 'gitops',
            managed_binding_id: 'binding-1',
            managed_revision: 'rev-2',
            last_git_hash: 'def456',
            sync_state: 'synced',
          },
        ];
      }

      return [];
    });

    const dataSource = { query } as any;
    const scope = {
      getDescendantIds: vi.fn().mockResolvedValue(['child-scope-1']),
      getTree: vi.fn().mockResolvedValue({
        id: 'scope-1',
        slug: '',
        children: [{ id: 'child-scope-1', slug: 'acme', children: [] }],
      }),
    } as any;

    const { SkillGitopsHandler } = await import('./skill.gitops-handler');
    const handler = new SkillGitopsHandler(dataSource, scope);

    const actual = await handler.readActual('scope-1');

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM skills'), [
      ['scope-1', 'child-scope-1'],
    ]);
    expect(actual).toEqual([
      expect.objectContaining({
        objectType: 'skill',
        key: '/acme:search',
        fields: expect.objectContaining({
          name: 'search',
          scope: '/acme',
          strategy: 'merge',
          description: 'Search the repo.',
          skillMarkdown: '# Search\n',
          source: 'repository',
          locked: false,
        }),
        managedBy: 'gitops',
        locked: false,
      }),
    ]);
  });

  it('soft-deletes gitops-managed skills and keeps other rows untouched', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const dataSource = { query } as any;
    const scope = {
      getDescendantIds: vi.fn().mockResolvedValue(['child-scope-1']),
      getTree: vi.fn().mockResolvedValue({
        id: 'scope-1',
        slug: '',
        children: [{ id: 'child-scope-1', slug: 'acme', children: [] }],
      }),
    } as any;

    const { SkillGitopsHandler } = await import('./skill.gitops-handler');
    const handler = new SkillGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'skill',
        key: '/acme:search',
        op: 'delete',
        desired: null,
        actual: {
          objectType: 'skill',
          key: '/acme:search',
          fields: {
            name: 'search',
            scope: '/acme',
          },
          managedBy: 'gitops',
          locked: false,
        },
      },
      {
        actorId: 'actor-1',
        manager: { query } as any,
        bindingId: 'binding-1',
      } as any,
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE skills'),
      expect.arrayContaining(['search', 'child-scope-1', 'gitops']),
    );
  });

  it('serializes replace skills without merge metadata', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM skills')) {
        return [
          {
            id: 'skill-2',
            name: 'search',
            description: 'Search the repo.',
            skill_markdown: '# Search\n',
            category: 'research',
            tags: 'search,repo',
            metadata: { audience: 'agent' },
            scope_node_id: 'child-scope-1',
            source: 'repository',
            locked: false,
            version: 3,
            is_active: true,
            overrides: null,
            base_ref: null,
            managed_by: 'gitops',
            managed_binding_id: 'binding-1',
            managed_revision: null,
            last_git_hash: null,
            sync_state: null,
          },
        ];
      }

      return [];
    });

    const dataSource = { query } as any;
    const scope = {
      getDescendantIds: vi.fn().mockResolvedValue(['child-scope-1']),
      getTree: vi.fn().mockResolvedValue({
        id: 'scope-1',
        slug: '',
        children: [{ id: 'child-scope-1', slug: 'acme', children: [] }],
      }),
    } as any;

    const { SkillGitopsHandler } = await import('./skill.gitops-handler');
    const handler = new SkillGitopsHandler(dataSource, scope);

    const actual = await handler.readActual('scope-1');

    expect(actual[0]?.fields).toMatchObject({
      strategy: 'replace',
      description: 'Search the repo.',
      skillMarkdown: '# Search\n',
    });
  });

  it('updates merge skills without overwriting the natural definition columns', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const dataSource = { query } as any;
    const scope = {
      getDescendantIds: vi.fn().mockResolvedValue(['child-scope-1']),
      getTree: vi.fn().mockResolvedValue({
        id: 'scope-1',
        slug: '',
        children: [{ id: 'child-scope-1', slug: 'acme', children: [] }],
      }),
    } as any;

    const { SkillGitopsHandler } = await import('./skill.gitops-handler');
    const handler = new SkillGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'skill',
        key: '/acme:search',
        op: 'update',
        desired: {
          objectType: 'skill',
          key: '/acme:search',
          fields: {
            name: 'search',
            scope: '/acme',
            strategy: 'merge',
            description: 'Search with patches.',
            overrides: { description: 'override' },
            baseRef: 'skill-base',
            managedBindingId: 'binding-1',
          },
        },
        actual: {
          objectType: 'skill',
          key: '/acme:search',
          fields: {
            name: 'search',
            scope: '/acme',
            strategy: 'merge',
            description: 'Search the repo.',
            overrides: { description: 'old' },
            baseRef: 'skill-base',
            managedBindingId: 'binding-1',
          },
          managedBy: 'gitops',
          locked: false,
        },
        diff: {
          overrides: {
            from: { description: 'old' },
            to: { description: 'override' },
          },
        },
      },
      {
        actorId: 'actor-1',
        manager: { query } as any,
        bindingId: 'binding-1',
      } as any,
    );

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('overrides = $');
    expect(sql).toContain('base_ref = $');
    expect(sql).not.toContain('description = $');
    expect(sql).not.toContain('skill_markdown = $');
    expect(params).toContain('binding-1');
    expect(params).not.toContain('binding-2');
  });

  it('updates only gitops-managed skills with the context binding id', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const dataSource = { query } as any;
    const scope = {
      getDescendantIds: vi.fn().mockResolvedValue(['child-scope-1']),
      getTree: vi.fn().mockResolvedValue({
        id: 'scope-1',
        slug: '',
        children: [{ id: 'child-scope-1', slug: 'acme', children: [] }],
      }),
    } as any;

    const { SkillGitopsHandler } = await import('./skill.gitops-handler');
    const handler = new SkillGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'skill',
        key: '/acme:search',
        op: 'update',
        desired: {
          objectType: 'skill',
          key: '/acme:search',
          fields: {
            name: 'search',
            scope: '/acme',
            strategy: 'merge',
            description: 'Search with patches.',
            overrides: { description: 'override' },
            baseRef: 'skill-base',
            managedBindingId: 'binding-2',
          },
        },
        actual: {
          objectType: 'skill',
          key: '/acme:search',
          fields: {
            name: 'search',
            scope: '/acme',
            strategy: 'merge',
            description: 'Search the repo.',
            overrides: { description: 'old' },
            baseRef: 'skill-base',
            managedBindingId: 'binding-1',
          },
          managedBy: 'gitops',
          locked: false,
        },
        diff: {
          overrides: {
            from: { description: 'old' },
            to: { description: 'override' },
          },
        },
      },
      {
        actorId: 'actor-1',
        manager: { query } as any,
        bindingId: 'binding-1',
      } as any,
    );

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('UPDATE skills');
    expect(params).toContain('binding-1');
    expect(params).not.toContain('binding-2');
  });

  it('updates replace skills in the natural definition columns and clears merge fields', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const dataSource = { query } as any;
    const scope = {
      getDescendantIds: vi.fn().mockResolvedValue(['child-scope-1']),
      getTree: vi.fn().mockResolvedValue({
        id: 'scope-1',
        slug: '',
        children: [{ id: 'child-scope-1', slug: 'acme', children: [] }],
      }),
    } as any;

    const { SkillGitopsHandler } = await import('./skill.gitops-handler');
    const handler = new SkillGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'skill',
        key: '/acme:search',
        op: 'update',
        desired: {
          objectType: 'skill',
          key: '/acme:search',
          fields: {
            name: 'search',
            scope: '/acme',
            strategy: 'replace',
            description: 'Search with context.',
            skillMarkdown: '# Search updated\n',
            category: 'research',
            tags: ['search'],
            metadata: { audience: 'agent' },
            version: 4,
            source: 'repository',
            locked: false,
            overrides: null,
            baseRef: null,
            managedBindingId: 'binding-1',
          },
        },
        actual: {
          objectType: 'skill',
          key: '/acme:search',
          fields: {
            name: 'search',
            scope: '/acme',
            strategy: 'merge',
            description: 'Search the repo.',
            overrides: { description: 'old' },
            baseRef: 'skill-base',
            managedBindingId: 'binding-1',
          },
          managedBy: 'gitops',
          locked: false,
        },
        diff: {
          description: { from: 'Search the repo.', to: 'Search with context.' },
        },
      },
      {
        actorId: 'actor-1',
        manager: { query } as any,
        bindingId: 'binding-1',
      } as any,
    );

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('description = $');
    expect(sql).toContain('is_active = true');
    expect(params).toEqual(
      expect.arrayContaining([
        'Search with context.',
        '# Search updated\n',
        null,
        null,
      ]),
    );
  });

  it('requires an apply-context binding id and forces repository source for creates', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const dataSource = { query } as any;
    const scope = {
      getDescendantIds: vi.fn().mockResolvedValue(['child-scope-1']),
      getTree: vi.fn().mockResolvedValue({
        id: 'scope-1',
        slug: '',
        children: [{ id: 'child-scope-1', slug: 'acme', children: [] }],
      }),
    } as any;

    const { SkillGitopsHandler } = await import('./skill.gitops-handler');
    const handler = new SkillGitopsHandler(dataSource, scope);
    const change = {
      objectType: 'skill' as const,
      key: '/acme:search',
      op: 'create' as const,
      desired: {
        objectType: 'skill' as const,
        key: '/acme:search',
        fields: {
          name: 'search',
          scope: '/acme',
          source: 'admin' as const,
          managedBindingId: 'binding-2',
        },
      },
      actual: null,
    };

    await expect(
      handler.apply(change, {
        actorId: 'actor-1',
        manager: { query } as any,
      } as any),
    ).rejects.toThrow('GitOps apply requires a repository binding id');
    expect(query).not.toHaveBeenCalled();

    await handler.apply(change, {
      actorId: 'actor-1',
      manager: { query } as any,
      bindingId: 'binding-1',
    } as any);

    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params).toContain('repository');
    expect(params).not.toContain('admin');
    expect(params).toContain('binding-1');
    expect(params).not.toContain('binding-2');
  });
});
