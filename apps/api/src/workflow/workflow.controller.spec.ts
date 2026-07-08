import { describe, it, expect, vi } from 'vitest';
import { WorkflowController } from './workflow.controller';

describe('WorkflowController scope filtering', () => {
  function make(accessibleIds: string[]) {
    const persistence = {
      getAllWorkflowsPaged: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(),
      getWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
      getWorkflowRunsPaged: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    } as any;
    const graph = {} as any;
    const eventLog = {
      getPagedHistory: vi.fn().mockResolvedValue({ events: [], total: 0 }),
    } as any;
    const scopeAccess = {
      restrictToAccessibleScopes: vi
        .fn()
        .mockImplementation(
          async (
            _userId: string,
            _permission: string,
            requestedScopeId?: string,
          ) => {
            if (!requestedScopeId) return accessibleIds;
            return accessibleIds.includes(requestedScopeId)
              ? [requestedScopeId]
              : [];
          },
        ),
    } as any;
    return {
      controller: new WorkflowController(
        persistence,
        graph,
        eventLog,
        scopeAccess,
        {} as any,
      ),
      persistence,
      scopeAccess,
    };
  }

  it('findAll still queries for platform (NULL-scoped) workflows when user has no accessible scopes', async () => {
    const { controller, persistence } = make([]);
    await controller.findAll({} as any, { user: { userId: 'u1' } });
    expect(persistence.getAllWorkflowsPaged).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scopeIds: [] }),
    );
  });

  it('findAll restricts the query to caller accessible scope ids', async () => {
    const { controller, persistence, scopeAccess } = make([
      'team-a',
      'team-a-child',
    ]);
    await controller.findAll({} as any, { user: { userId: 'u1' } });
    expect(scopeAccess.restrictToAccessibleScopes).toHaveBeenCalledWith(
      'u1',
      'workflows:read',
      undefined,
    );
    expect(persistence.getAllWorkflowsPaged).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scopeIds: ['team-a', 'team-a-child'] }),
    );
  });

  it('findAll narrows the query to a requested scopeNodeId', async () => {
    const { controller, persistence, scopeAccess } = make([
      'team-a',
      'team-a-child',
    ]);
    await controller.findAll({ scopeNodeId: 'team-a' } as any, {
      user: { userId: 'u1' },
    });
    expect(scopeAccess.restrictToAccessibleScopes).toHaveBeenCalledWith(
      'u1',
      'workflows:read',
      'team-a',
    );
    expect(persistence.getAllWorkflowsPaged).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scopeIds: ['team-a'] }),
    );
  });

  it('findAll returns no scope ids for an out-of-subtree scopeNodeId', async () => {
    const { controller, persistence } = make(['team-a']);
    await controller.findAll({ scopeNodeId: 'team-b' } as any, {
      user: { userId: 'u1' },
    });
    expect(persistence.getAllWorkflowsPaged).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scopeIds: [] }),
    );
  });
});

describe('WorkflowController.findRuns filter passthrough', () => {
  function makeForRuns() {
    const persistence = {
      getWorkflowRunsPaged: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    } as any;
    const controller = new WorkflowController(
      persistence,
      {} as any,
      {} as any,
      { getAccessibleScopeIds: vi.fn().mockResolvedValue([]) } as any,
      {} as any,
    );
    return { controller, persistence };
  }

  it('passes sourceType and scopeId to the persistence layer', async () => {
    const { controller, persistence } = makeForRuns();
    await controller.findRuns({
      sourceType: 'repository',
      scopeId: 'proj-1',
      limit: 20,
      offset: 0,
    });
    expect(persistence.getWorkflowRunsPaged).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceType: 'repository', scopeId: 'proj-1' }),
    );
  });
});

describe('WorkflowController GitOps actor propagation', () => {
  function makeForMutations() {
    const persistence = {
      updateWorkflow: vi.fn().mockResolvedValue({ id: 'workflow-1' }),
      deleteWorkflow: vi.fn().mockResolvedValue(undefined),
      createScopedOverride: vi.fn().mockResolvedValue({ id: 'workflow-2' }),
    } as any;
    const controller = new WorkflowController(
      persistence,
      {} as any,
      {} as any,
      { getAccessibleScopeIds: vi.fn().mockResolvedValue([]) } as any,
      {} as any,
    );
    return { controller, persistence };
  }

  it('passes the authenticated actor to workflow updates', async () => {
    const { controller, persistence } = makeForMutations();

    await controller.updatePut(
      'workflow-1',
      { yaml_definition: 'name: deploy' },
      { user: { userId: 'user-1' } },
    );

    expect(persistence.updateWorkflow).toHaveBeenCalledWith(
      'workflow-1',
      'name: deploy',
      'user-1',
    );
  });

  it('passes the authenticated actor to scoped workflow overrides', async () => {
    const { controller, persistence } = makeForMutations();

    await controller.forkWorkflowForScope(
      'workflow-1',
      'scope-1',
      { yaml_definition: 'name: deploy' },
      { user: { userId: 'user-1' } },
    );

    expect(persistence.createScopedOverride).toHaveBeenCalledWith(
      'workflow-1',
      'scope-1',
      'name: deploy',
      'user-1',
    );
  });
});
