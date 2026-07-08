import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VariableResolverService } from './variable-resolver.service';
import type { ScopedVariableRepository } from './database/repositories/scoped-variable.repository';
import type { ScopeService } from '../scope/scope.service';

function row(partial: Record<string, unknown>) {
  return {
    id: 'x',
    value_type: 'number',
    source: 'seeded',
    description: null,
    ...partial,
  };
}

describe('VariableResolverService', () => {
  let repo: ScopedVariableRepository;
  let scope: ScopeService;
  let service: VariableResolverService;

  beforeEach(() => {
    repo = {
      findGlobals: vi.fn().mockResolvedValue([]),
      findByScopeIds: vi.fn().mockResolvedValue([]),
    } as unknown as ScopedVariableRepository;
    scope = {
      getAncestorIds: vi.fn().mockResolvedValue([]),
    } as unknown as ScopeService;
    service = new VariableResolverService(repo, scope);
  });

  it('returns only global vars when scopeNodeId is null', async () => {
    (repo.findGlobals as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ key: 'gates.threshold', value: 10, scope_node_id: null }),
    ]);
    const result = await service.resolveEffective(null);
    expect(result).toEqual([
      { key: 'gates.threshold', value: 10, type: 'number', layer: 'global' },
    ]);
    expect(scope.getAncestorIds).not.toHaveBeenCalled();
  });

  it('overlays project value over global (leaf wins)', async () => {
    (repo.findGlobals as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ key: 'gates.threshold', value: 10, scope_node_id: null }),
    ]);
    (scope.getAncestorIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      'root',
      'project-1',
    ]);
    (repo.findByScopeIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ key: 'gates.threshold', value: 5, scope_node_id: 'project-1' }),
    ]);
    const result = await service.resolveEffective('project-1');
    expect(result).toEqual([
      { key: 'gates.threshold', value: 5, type: 'number', layer: 'project-1' },
    ]);
  });

  it('coerces values by value_type', async () => {
    (repo.findGlobals as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({
        key: 'backlog.ideation_enabled',
        value: 'true',
        value_type: 'boolean',
        scope_node_id: null,
      }),
    ]);
    const result = await service.resolveEffective(null);
    expect(result[0].value).toBe(true);
  });

  it('resolveContext expands dotted keys into nested objects', async () => {
    (repo.findGlobals as ReturnType<typeof vi.fn>).mockResolvedValue([
      row({ key: 'gates.threshold', value: 10, scope_node_id: null }),
      row({
        key: 'autonomy.dispatch',
        value: 'auto',
        value_type: 'string',
        scope_node_id: null,
      }),
    ]);
    const ctx = await service.resolveContext(null);
    expect(ctx).toEqual({
      gates: { threshold: 10 },
      autonomy: { dispatch: 'auto' },
    });
  });
});
