import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScopedConfigResolver } from './scoped-config-resolver.service';
import { GLOBAL_SCOPE_NODE_ID } from '../scope/scope.constants';

const ORG = 'org-id';
const TEAM = 'team-id';
const PROJECT = 'project-id';

function makeSource(rows: any[]) {
  return {
    objectType: 'workflow' as const,
    loadCandidates: vi.fn().mockResolvedValue(rows),
  };
}

describe('ScopedConfigResolver.resolve', () => {
  let scopeService: any;
  let cache: any;

  beforeEach(() => {
    scopeService = {
      getAncestorIds: vi
        .fn()
        .mockResolvedValue([GLOBAL_SCOPE_NODE_ID, ORG, TEAM, PROJECT]),
    };
    cache = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
      invalidate: vi.fn(),
    };
  });

  it('project override beats team beats org beats platform default', async () => {
    const rows = [
      {
        rowId: 'd',
        scopeNodeId: null,
        source: 'seeded',
        locked: false,
        strategy: 'replace',
        definition: { v: 'default' },
        overrides: null,
        baseRef: null,
      },
      {
        rowId: 'o',
        scopeNodeId: ORG,
        source: 'admin',
        locked: false,
        strategy: 'replace',
        definition: { v: 'org' },
        overrides: null,
        baseRef: null,
      },
      {
        rowId: 't',
        scopeNodeId: TEAM,
        source: 'admin',
        locked: false,
        strategy: 'replace',
        definition: { v: 'team' },
        overrides: null,
        baseRef: null,
      },
      {
        rowId: 'p',
        scopeNodeId: PROJECT,
        source: 'admin',
        locked: false,
        strategy: 'replace',
        definition: { v: 'project' },
        overrides: null,
        baseRef: null,
      },
    ];
    const resolver = new ScopedConfigResolver(scopeService, cache);
    resolver.register(makeSource(rows));

    const eff = await resolver.resolve('workflow', 'wf', PROJECT);
    expect(eff.value).toEqual({ v: 'project' });
    expect(eff.isDefault).toBe(false);
  });

  it('falls back to the platform default when no scoped row matches', async () => {
    const rows = [
      {
        rowId: 'd',
        scopeNodeId: GLOBAL_SCOPE_NODE_ID,
        source: 'seeded',
        locked: false,
        strategy: 'replace',
        definition: { v: 'default' },
        overrides: null,
        baseRef: null,
      },
    ];
    const resolver = new ScopedConfigResolver(scopeService, cache);
    resolver.register(makeSource(rows));

    const eff = await resolver.resolve('workflow', 'wf', PROJECT);
    expect(eff.value).toEqual({ v: 'default' });
    expect(eff.isDefault).toBe(true);
  });

  it('layers a merge override onto the next-most-specific base', async () => {
    const rows = [
      {
        rowId: 'd',
        scopeNodeId: null,
        source: 'seeded',
        locked: false,
        strategy: 'replace',
        definition: { a: 1, b: 2 },
        overrides: null,
        baseRef: null,
      },
      {
        rowId: 't',
        scopeNodeId: TEAM,
        source: 'admin',
        locked: false,
        strategy: 'merge',
        definition: null,
        overrides: { b: 9 },
        baseRef: null,
      },
    ];
    const resolver = new ScopedConfigResolver(scopeService, cache);
    resolver.register(makeSource(rows));

    const eff = await resolver.resolve('workflow', 'wf', TEAM);
    expect(eff.value).toEqual({ a: 1, b: 9 });
  });

  it('throws for an unregistered object type', async () => {
    const resolver = new ScopedConfigResolver(scopeService, cache);
    await expect(
      resolver.resolve('agent_profile', 'x', PROJECT),
    ).rejects.toThrow(/no config source/i);
  });

  it('returns cached result without calling scopeService or source', async () => {
    const cached = {
      value: { v: 'cached' },
      objectType: 'workflow',
      name: 'wf',
      scopeNodeId: PROJECT,
      contributingLayers: [],
      isDefault: false,
      locked: false,
    } as any;
    cache.get.mockReturnValue(cached);
    const resolver = new ScopedConfigResolver(scopeService, cache);
    resolver.register(makeSource([]));

    const eff = await resolver.resolve('workflow', 'wf', PROJECT);
    expect(eff).toBe(cached);
    expect(scopeService.getAncestorIds).not.toHaveBeenCalled();
  });
});
