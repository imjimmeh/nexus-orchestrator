import { describe, it, expect, vi } from 'vitest';
import { ScopedAiDefaultResolver } from './scoped-ai-default-resolver';

function makeResolver(opts: {
  rows: Array<{
    scopeNodeId: string | null;
    harnessId?: string | null;
    modelName?: string | null;
    providerName?: string | null;
  }>;
  ancestorIds?: string[];
}) {
  const byScope = new Map(opts.rows.map((r) => [r.scopeNodeId, r]));
  const repo = {
    getForScope: vi.fn(async (id: string | null) => byScope.get(id) ?? null),
    upsertForScope: vi.fn(),
    findForScopeIds: vi.fn(async (ids: string[]) =>
      ids
        .map((id) => byScope.get(id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r)),
    ),
  };
  const scope = {
    getAncestorIds: vi.fn(async () => opts.ancestorIds ?? []),
  };
  return {
    resolver: new ScopedAiDefaultResolver(repo as never, scope as never),
    repo,
    scope,
  };
}

describe('ScopedAiDefaultResolver', () => {
  it('returns platform-only defaults when no scope is given', async () => {
    const { resolver } = makeResolver({
      rows: [
        {
          scopeNodeId: null,
          harnessId: 'pi',
          modelName: 'gpt-x',
          providerName: 'openai',
        },
      ],
    });
    const r = await resolver.resolve();
    expect(r).toEqual({
      harnessId: 'pi',
      modelName: 'gpt-x',
      providerName: 'openai',
    });
  });

  it('a scoped row overrides the platform default', async () => {
    // ancestorIds root-first incl self: [root, scope-a]; reversed → [scope-a, root]
    const { resolver } = makeResolver({
      ancestorIds: ['root', 'scope-a'],
      rows: [
        { scopeNodeId: null, harnessId: 'pi' },
        { scopeNodeId: 'scope-a', harnessId: 'claude-code' },
      ],
    });
    const r = await resolver.resolve('scope-a');
    expect(r.harnessId).toBe('claude-code');
  });

  it('merges per field: most-specific harness, platform model/provider', async () => {
    const { resolver } = makeResolver({
      ancestorIds: ['root', 'scope-a'],
      rows: [
        {
          scopeNodeId: null,
          harnessId: 'pi',
          modelName: 'gpt-x',
          providerName: 'openai',
        },
        {
          scopeNodeId: 'scope-a',
          harnessId: 'claude-code',
          modelName: null,
          providerName: null,
        },
      ],
    });
    const r = await resolver.resolve('scope-a');
    expect(r).toEqual({
      harnessId: 'claude-code', // from scope-a
      modelName: 'gpt-x', // falls through to platform
      providerName: 'openai', // falls through to platform
    });
  });

  it('walks ancestors most-specific first', async () => {
    // [root, parent, child] root-first; reversed → [child, parent, root, null]
    const { resolver } = makeResolver({
      ancestorIds: ['root', 'parent', 'child'],
      rows: [
        { scopeNodeId: null, providerName: 'openai' },
        { scopeNodeId: 'parent', harnessId: 'pi', modelName: 'gpt-parent' },
        { scopeNodeId: 'child', harnessId: 'claude-code' },
      ],
    });
    const r = await resolver.resolve('child');
    expect(r.harnessId).toBe('claude-code'); // child
    expect(r.modelName).toBe('gpt-parent'); // parent
    expect(r.providerName).toBe('openai'); // platform
  });
});
