import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VariablesController } from './variables.controller';
import type { ScopedVariableRepository } from './database/repositories/scoped-variable.repository';
import type { ScopedVariableAuditRepository } from './database/repositories/scoped-variable-audit.repository';
import type { VariableResolverService } from './variable-resolver.service';
import type { ScopeAccessService } from '../auth/authorization/scope-access.service';

const REQ = { user: { userId: 'user-1', email: 'u@x', roles: [] } };

describe('VariablesController', () => {
  let repo: ScopedVariableRepository;
  let auditRepo: ScopedVariableAuditRepository;
  let resolver: VariableResolverService;
  let scopeAccess: ScopeAccessService;
  let controller: VariablesController;

  beforeEach(() => {
    repo = {
      listForScope: vi.fn().mockResolvedValue([]),
      upsert: vi
        .fn()
        .mockImplementation((x) => Promise.resolve({ id: '1', ...x })),
      deleteByKeyAndScope: vi.fn().mockResolvedValue(undefined),
    } as unknown as ScopedVariableRepository;
    auditRepo = {
      listFor: vi.fn().mockResolvedValue([]),
    } as unknown as ScopedVariableAuditRepository;
    resolver = {
      resolveEffective: vi.fn().mockResolvedValue([]),
    } as unknown as VariableResolverService;
    scopeAccess = {
      restrictToAccessibleScopes: vi
        .fn()
        .mockImplementation(
          async (
            _userId: string,
            _permission: string,
            requestedScopeId?: string,
          ) => (requestedScopeId ? [requestedScopeId] : []),
        ),
    } as unknown as ScopeAccessService;
    controller = new VariablesController(
      repo,
      auditRepo,
      resolver,
      scopeAccess,
    );
  });

  it('lists global vars when no scopeId given', async () => {
    await controller.list(undefined, REQ);
    expect(repo.listForScope).toHaveBeenCalledWith(null);
  });

  it('lists vars for an accessible scope', async () => {
    await controller.list('project-1', REQ);
    expect(scopeAccess.restrictToAccessibleScopes).toHaveBeenCalledWith(
      'user-1',
      'settings:read',
      'project-1',
    );
    expect(repo.listForScope).toHaveBeenCalledWith('project-1');
  });

  it('default-denies an out-of-subtree scopeId', async () => {
    (
      scopeAccess.restrictToAccessibleScopes as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);

    const result = await controller.list('project-out-of-subtree', REQ);

    expect(repo.listForScope).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: [] });
  });

  it('upserts a variable, attributing the actor from the JWT', async () => {
    const dto = {
      scopeNodeId: null,
      key: 'gates.threshold',
      value: 10,
      valueType: 'number' as const,
    };
    const result = await controller.upsert(dto, REQ);
    expect(repo.upsert).toHaveBeenCalledWith(dto, 'user-1');
    expect(result.success).toBe(true);
  });

  it('deletes a variable, attributing the actor from the JWT', async () => {
    await controller.remove('gates.threshold', 'project-1', REQ);
    expect(repo.deleteByKeyAndScope).toHaveBeenCalledWith(
      'gates.threshold',
      'project-1',
      'user-1',
    );
  });

  it('resolves effective vars for a scope', async () => {
    await controller.effective('project-1');
    expect(resolver.resolveEffective).toHaveBeenCalledWith('project-1');
  });

  it('lists audit history for a scope and key', async () => {
    await controller.audit('project-1', 'gates.threshold');
    expect(auditRepo.listFor).toHaveBeenCalledWith(
      'project-1',
      'gates.threshold',
    );
  });
});
