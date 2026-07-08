import { describe, expect, it, vi } from 'vitest';

describe('WorkflowGitopsHandler', () => {
  it('reads workflows from the scope subtree and serializes repository-managed rows', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM workflows')) {
        return [
          {
            id: 'workflow-1',
            name: 'build-pipeline',
            yaml_definition: 'name: build-pipeline\n',
            is_active: true,
            source_type: 'user',
            scope_id: null,
            source_path: null,
            source_ref: null,
            source_hash: null,
            scope_node_id: 'child-scope-1',
            source: 'repository',
            managed_by: 'gitops',
            locked: false,
            overrides: { strategy: 'replace' },
            base_ref: null,
            base_workflow_id: null,
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

    const { WorkflowGitopsHandler } = await import('./workflow.gitops-handler');
    const handler = new WorkflowGitopsHandler(dataSource, scope);

    const actual = await handler.readActual('scope-1');

    expect(scope.getDescendantIds).toHaveBeenCalledWith('scope-1');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM workflows'),
      [['scope-1', 'child-scope-1']],
    );
    expect(actual).toEqual([
      expect.objectContaining({
        objectType: 'workflow',
        key: '/acme:build-pipeline',
        fields: expect.objectContaining({
          name: 'build-pipeline',
          scope: '/acme',
          strategy: 'merge',
          definition: 'name: build-pipeline\n',
          overrides: { strategy: 'replace' },
          source: 'repository',
          locked: false,
        }),
        managedBy: 'gitops',
        locked: false,
      }),
    ]);
  });

  it('updates workflows using the apply-context binding id instead of spoofed desired ownership', async () => {
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

    const { WorkflowGitopsHandler } = await import('./workflow.gitops-handler');
    const handler = new WorkflowGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'workflow',
        key: '/acme:build-pipeline',
        op: 'update',
        desired: {
          objectType: 'workflow',
          key: '/acme:build-pipeline',
          fields: {
            name: 'build-pipeline',
            scope: '/acme',
            strategy: 'replace',
            definition: 'name: build-pipeline\n',
            managedBindingId: 'binding-2',
          },
        },
        actual: {
          objectType: 'workflow',
          key: '/acme:build-pipeline',
          fields: {
            name: 'build-pipeline',
            scope: '/acme',
            strategy: 'replace',
            definition: 'name: build-pipeline\n',
            managedBindingId: 'binding-1',
          },
          managedBy: 'gitops',
          locked: false,
        },
        diff: {
          definition: {
            from: 'name: build-pipeline\n',
            to: 'name: build-pipeline\n',
          },
          managedBindingId: { from: 'binding-1', to: 'binding-2' },
        },
      },
      {
        actorId: 'actor-1',
        manager: { query } as any,
        bindingId: 'binding-1',
        conflictPolicy: 'require_review',
      } as any,
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflows'),
      expect.arrayContaining([
        'build-pipeline',
        'child-scope-1',
        'gitops',
        'binding-1',
      ]),
    );
    expect(query.mock.calls[0]?.[1]).not.toContain('binding-2');
  });

  it('stores merge strategy workflows without overwriting the base definition', async () => {
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

    const { WorkflowGitopsHandler } = await import('./workflow.gitops-handler');
    const handler = new WorkflowGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'workflow',
        key: '/acme:build-pipeline',
        op: 'update',
        desired: {
          objectType: 'workflow',
          key: '/acme:build-pipeline',
          fields: {
            name: 'build-pipeline',
            scope: '/acme',
            strategy: 'merge',
            definition: 'name: new-base\n',
            overrides: { is_active: false },
            baseRef: 'workflow-base',
            managedBindingId: 'binding-1',
          },
        },
        actual: {
          objectType: 'workflow',
          key: '/acme:build-pipeline',
          fields: {
            name: 'build-pipeline',
            scope: '/acme',
            strategy: 'merge',
            definition: 'name: old-base\n',
            overrides: { is_active: true },
            baseRef: 'workflow-base',
            managedBindingId: 'binding-1',
          },
          managedBy: 'gitops',
          locked: false,
        },
        diff: {
          overrides: { from: { is_active: true }, to: { is_active: false } },
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
    expect(sql).not.toContain('yaml_definition = $');
    expect(params).toEqual(
      expect.arrayContaining(['workflow-base', 'binding-1']),
    );
  });

  it('stores replace strategy workflows in the definition column and clears merge fields', async () => {
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

    const { WorkflowGitopsHandler } = await import('./workflow.gitops-handler');
    const handler = new WorkflowGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'workflow',
        key: '/acme:build-pipeline',
        op: 'update',
        desired: {
          objectType: 'workflow',
          key: '/acme:build-pipeline',
          fields: {
            name: 'build-pipeline',
            scope: '/acme',
            strategy: 'replace',
            definition: 'name: replaced\n',
            overrides: null,
            baseRef: null,
            managedBindingId: 'binding-1',
          },
        },
        actual: {
          objectType: 'workflow',
          key: '/acme:build-pipeline',
          fields: {
            name: 'build-pipeline',
            scope: '/acme',
            strategy: 'merge',
            definition: 'name: old-base\n',
            overrides: { is_active: false },
            baseRef: 'workflow-base',
            managedBindingId: 'binding-1',
          },
          managedBy: 'gitops',
          locked: false,
        },
        diff: {
          definition: { from: 'name: old-base\n', to: 'name: replaced\n' },
        },
      },
      {
        actorId: 'actor-1',
        manager: { query } as any,
        bindingId: 'binding-1',
      } as any,
    );

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('yaml_definition = $');
    expect(params).toEqual(
      expect.arrayContaining(['name: replaced\n', null, null]),
    );
  });

  it('requires an apply-context binding id for repository-managed creates', async () => {
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

    const { WorkflowGitopsHandler } = await import('./workflow.gitops-handler');
    const handler = new WorkflowGitopsHandler(dataSource, scope);

    await expect(
      handler.apply(
        {
          objectType: 'workflow',
          key: '/acme:build-pipeline',
          op: 'create',
          desired: {
            objectType: 'workflow',
            key: '/acme:build-pipeline',
            fields: {
              name: 'build-pipeline',
              scope: '/acme',
              definition: 'name: build-pipeline\n',
              source: 'admin',
              managedBindingId: 'binding-2',
            },
          },
          actual: null,
        },
        { actorId: 'actor-1', manager: { query } as any } as any,
      ),
    ).rejects.toThrow('GitOps apply requires a repository binding id');
    expect(query).not.toHaveBeenCalled();
  });

  it('forces repository source for gitops-created workflows', async () => {
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

    const { WorkflowGitopsHandler } = await import('./workflow.gitops-handler');
    const handler = new WorkflowGitopsHandler(dataSource, scope);

    await handler.apply(
      {
        objectType: 'workflow',
        key: '/acme:build-pipeline',
        op: 'create',
        desired: {
          objectType: 'workflow',
          key: '/acme:build-pipeline',
          fields: {
            name: 'build-pipeline',
            scope: '/acme',
            definition: 'name: build-pipeline\n',
            source: 'admin',
          },
        },
        actual: null,
      },
      {
        actorId: 'actor-1',
        manager: { query } as any,
        bindingId: 'binding-1',
      } as any,
    );

    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params).toContain('repository');
    expect(params).not.toContain('admin');
  });
});
