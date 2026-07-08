import { describe, expect, it, vi } from 'vitest';

describe('AgentProfileGitopsHandler', () => {
  it('reads profiles from the scope subtree and serializes repository-managed rows', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM agent_profiles')) {
        return [
          {
            id: 'profile-1',
            name: 'assistant',
            system_prompt: 'Be helpful.',
            model_name: 'gpt-5',
            provider_name: 'openai',
            provider_id: 'provider-1',
            provider_source: 'scope',
            tier_preference: 'primary',
            supports_vision: true,
            allowed_mount_aliases: 'docs,repo',
            denied_mount_aliases: null,
            allow_rw_mount_aliases: null,
            assigned_skills: 'search,write',
            source: 'repository',
            created_by_profile: null,
            created_by_workflow_run_id: null,
            factory_context: null,
            tool_policy: { mode: 'allow' },
            is_active: true,
            scope_node_id: 'child-scope-1',
            locked: false,
            overrides: { strategy: 'replace' },
            base_ref: null,
            base_profile_id: null,
            managed_by: 'gitops',
            managed_binding_id: 'binding-1',
            managed_revision: 'rev-1',
            last_git_hash: 'abc123',
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

    const { AgentProfileGitopsHandler } =
      await import('./agent-profile.gitops-handler');
    const handler = new AgentProfileGitopsHandler(dataSource, scope);

    const actual = await handler.readActual('scope-1');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM agent_profiles'),
      [['scope-1', 'child-scope-1']],
    );
    expect(actual).toEqual([
      expect.objectContaining({
        objectType: 'agent_profile',
        key: '/acme:assistant',
        fields: expect.objectContaining({
          name: 'assistant',
          scope: '/acme',
          strategy: 'merge',
          systemPrompt: 'Be helpful.',
          modelName: 'gpt-5',
          providerName: 'openai',
          assignedSkills: ['search', 'write'],
          source: 'repository',
          locked: false,
        }),
        managedBy: 'gitops',
        locked: false,
      }),
    ]);
  });

  it('serializes replace profiles without merge metadata', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM agent_profiles')) {
        return [
          {
            id: 'profile-2',
            name: 'assistant',
            system_prompt: 'Be precise.',
            model_name: 'gpt-5.1',
            provider_name: 'openai',
            provider_id: 'provider-2',
            provider_source: 'scope',
            tier_preference: 'primary',
            supports_vision: false,
            allowed_mount_aliases: null,
            denied_mount_aliases: null,
            allow_rw_mount_aliases: null,
            assigned_skills: null,
            source: 'repository',
            tool_policy: null,
            is_active: true,
            scope_node_id: 'child-scope-1',
            locked: false,
            overrides: null,
            base_ref: null,
            base_profile_id: null,
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

    const { AgentProfileGitopsHandler } =
      await import('./agent-profile.gitops-handler');
    const handler = new AgentProfileGitopsHandler(dataSource, scope);

    const actual = await handler.readActual('scope-1');

    expect(actual[0]?.fields).toMatchObject({
      strategy: 'replace',
      systemPrompt: 'Be precise.',
      modelName: 'gpt-5.1',
    });
  });

  it('updates only gitops-managed rows with the context binding id', async () => {
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

    const { AgentProfileGitopsHandler } =
      await import('./agent-profile.gitops-handler');
    const handler = new AgentProfileGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'agent_profile',
        key: '/acme:assistant',
        op: 'update',
        desired: {
          objectType: 'agent_profile',
          key: '/acme:assistant',
          fields: {
            name: 'assistant',
            scope: '/acme',
            systemPrompt: 'Be more helpful.',
            managedBindingId: 'binding-2',
          },
        },
        actual: {
          objectType: 'agent_profile',
          key: '/acme:assistant',
          fields: {
            name: 'assistant',
            scope: '/acme',
            systemPrompt: 'Be helpful.',
            managedBindingId: 'binding-1',
          },
          managedBy: 'gitops',
          locked: false,
        },
        diff: {
          systemPrompt: { from: 'Be helpful.', to: 'Be more helpful.' },
          managedBindingId: { from: 'binding-1', to: 'binding-2' },
        },
      },
      {
        actorId: 'actor-1',
        manager: { query } as any,
        bindingId: 'binding-1',
      } as any,
    );

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('UPDATE agent_profiles');
    expect(params).toContain('binding-1');
    expect(params).not.toContain('binding-2');
  });

  it('updates merge profiles without overwriting the natural definition columns', async () => {
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

    const { AgentProfileGitopsHandler } =
      await import('./agent-profile.gitops-handler');
    const handler = new AgentProfileGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'agent_profile',
        key: '/acme:assistant',
        op: 'update',
        desired: {
          objectType: 'agent_profile',
          key: '/acme:assistant',
          fields: {
            name: 'assistant',
            scope: '/acme',
            strategy: 'merge',
            systemPrompt: 'Be more helpful.',
            overrides: { systemPrompt: 'override' },
            baseRef: 'profile-base',
            managedBindingId: 'binding-1',
          },
        },
        actual: {
          objectType: 'agent_profile',
          key: '/acme:assistant',
          fields: {
            name: 'assistant',
            scope: '/acme',
            strategy: 'merge',
            systemPrompt: 'Be helpful.',
            overrides: { systemPrompt: 'old' },
            baseRef: 'profile-base',
            managedBindingId: 'binding-1',
          },
          managedBy: 'gitops',
          locked: false,
        },
        diff: {
          overrides: {
            from: { systemPrompt: 'old' },
            to: { systemPrompt: 'override' },
          },
        },
      },
      {
        actorId: 'actor-1',
        manager: { query } as any,
        bindingId: 'binding-1',
      } as any,
    );

    const [sql] = query.mock.calls[0];
    expect(sql).toContain('overrides = $');
    expect(sql).toContain('base_ref = $');
    expect(sql).not.toContain('system_prompt = $');
    expect(sql).not.toContain('model_name = $');
  });

  it('updates replace profiles in the natural definition columns and clears merge fields', async () => {
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

    const { AgentProfileGitopsHandler } =
      await import('./agent-profile.gitops-handler');
    const handler = new AgentProfileGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'agent_profile',
        key: '/acme:assistant',
        op: 'update',
        desired: {
          objectType: 'agent_profile',
          key: '/acme:assistant',
          fields: {
            name: 'assistant',
            scope: '/acme',
            strategy: 'replace',
            systemPrompt: 'Be direct.',
            modelName: 'gpt-5.1',
            providerName: 'openai',
            providerId: 'provider-2',
            providerSource: 'scope',
            tierPreference: 'secondary',
            supportsVision: true,
            allowedMountAliases: ['docs'],
            deniedMountAliases: null,
            allowRwMountAliases: null,
            assignedSkills: ['search'],
            toolPolicy: { mode: 'allow' },
            source: 'repository',
            locked: false,
            overrides: null,
            baseRef: null,
            managedBindingId: 'binding-1',
          },
        },
        actual: {
          objectType: 'agent_profile',
          key: '/acme:assistant',
          fields: {
            name: 'assistant',
            scope: '/acme',
            strategy: 'merge',
            systemPrompt: 'Be helpful.',
            overrides: { systemPrompt: 'old' },
            baseRef: 'profile-base',
            managedBindingId: 'binding-1',
          },
          managedBy: 'gitops',
          locked: false,
        },
        diff: {
          systemPrompt: { from: 'Be helpful.', to: 'Be direct.' },
        },
      },
      {
        actorId: 'actor-1',
        manager: { query } as any,
        bindingId: 'binding-1',
      } as any,
    );

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('system_prompt = $');
    expect(sql).toContain('is_active = true');
    expect(params).toEqual(expect.arrayContaining(['Be direct.', null, null]));
  });

  it('serializes replace array fields before updating agent profile rows', async () => {
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

    const { AgentProfileGitopsHandler } =
      await import('./agent-profile.gitops-handler');
    const handler = new AgentProfileGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'agent_profile',
        key: '/acme:assistant',
        op: 'update',
        desired: {
          objectType: 'agent_profile',
          key: '/acme:assistant',
          fields: {
            name: 'assistant',
            scope: '/acme',
            strategy: 'replace',
            allowedMountAliases: ['docs', 'repo'],
            assignedSkills: ['search', 'write'],
          },
        },
        actual: {
          objectType: 'agent_profile',
          key: '/acme:assistant',
          fields: { name: 'assistant', scope: '/acme' },
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

    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params).toContain('docs,repo');
    expect(params).toContain('search,write');
    expect(params).not.toContainEqual(['docs', 'repo']);
    expect(params).not.toContainEqual(['search', 'write']);
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

    const { AgentProfileGitopsHandler } =
      await import('./agent-profile.gitops-handler');
    const handler = new AgentProfileGitopsHandler(dataSource, scope);
    const change = {
      objectType: 'agent_profile' as const,
      key: '/acme:assistant',
      op: 'create' as const,
      desired: {
        objectType: 'agent_profile' as const,
        key: '/acme:assistant',
        fields: {
          name: 'assistant',
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
