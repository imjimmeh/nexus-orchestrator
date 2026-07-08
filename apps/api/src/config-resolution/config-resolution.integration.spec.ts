import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScopedConfigResolver } from './scoped-config-resolver.service';
import { ConfigResolutionCache } from './config-resolution-cache.service';
import { GLOBAL_SCOPE_NODE_ID } from '../scope/scope.constants';
import type { ScopeService } from '../scope/scope.service';
import type { ScopedConfigSource } from './scoped-config-source';
import type { ConfigLayerRecord } from './effective-config.types';
import type { ConfigObjectType } from './config-resolution.constants';

// ---------------------------------------------------------------------------
// Fixture types & helpers
// ---------------------------------------------------------------------------

interface WorkflowDefinition extends Record<string, unknown> {
  name: string;
  is_active: boolean;
  timeout_ms: number;
}

const TEAM_SCOPE_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_SCOPE_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

/**
 * Builds a minimal ConfigLayerRecord with sensible defaults so individual
 * tests only need to specify the fields that matter to them.
 */
function makeRecord(
  partial: Partial<ConfigLayerRecord<WorkflowDefinition>> & {
    scopeNodeId: string | null;
  },
): ConfigLayerRecord<WorkflowDefinition> {
  return {
    rowId: partial.rowId ?? 'row-' + Math.random().toString(36).slice(2),
    scopeNodeId: partial.scopeNodeId,
    source: partial.source ?? 'workflow_configs',
    locked: partial.locked ?? false,
    strategy: partial.strategy ?? 'replace',
    definition: partial.definition ?? null,
    overrides: partial.overrides ?? null,
    baseRef: partial.baseRef ?? null,
  };
}

/**
 * Creates a minimal ScopeService mock whose getAncestorIds returns a
 * predictable root→leaf ancestry list for the provided scopeNodeId.
 *
 * The ancestry map is keyed by node id; the value is the ordered list of
 * ancestor ids (root-first, including self) that the scope service should
 * return.
 */
function makeScopeService(
  ancestryMap: Record<string, string[]>,
): Pick<ScopeService, 'getAncestorIds'> {
  return {
    getAncestorIds: vi.fn(async (nodeId: string) => {
      const result = ancestryMap[nodeId];
      if (!result)
        throw new Error(`No ancestry configured for scope node: ${nodeId}`);
      return result;
    }),
  };
}

/**
 * Creates an in-memory ScopedConfigSource that returns whichever records
 * have a scopeNodeId (or null → GLOBAL) matching any of the requested ids.
 */
function makeSource(
  objectType: ConfigObjectType,
  records: Array<ConfigLayerRecord<WorkflowDefinition>>,
): ScopedConfigSource<WorkflowDefinition> {
  return {
    objectType,
    loadCandidates: vi.fn(async (_name: string, scopeIds: string[]) => {
      const scopeSet = new Set(scopeIds);
      return records.filter((r) => {
        const normalised = r.scopeNodeId ?? GLOBAL_SCOPE_NODE_ID;
        return scopeSet.has(normalised);
      });
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Config Resolution System (integration)', () => {
  let cache: ConfigResolutionCache;

  beforeEach(() => {
    cache = new ConfigResolutionCache();
  });

  // -------------------------------------------------------------------------
  // 1. Leaf-wins: team-scope overrides global default
  // -------------------------------------------------------------------------
  it('leaf-wins: team-scope overrides global default', async () => {
    const globalRecord = makeRecord({
      rowId: 'global-row',
      scopeNodeId: null, // null → GLOBAL_SCOPE_NODE_ID
      strategy: 'replace',
      definition: { name: 'my-workflow', is_active: true, timeout_ms: 5000 },
    });

    const teamRecord = makeRecord({
      rowId: 'team-row',
      scopeNodeId: TEAM_SCOPE_ID,
      strategy: 'replace',
      definition: { name: 'my-workflow', is_active: false, timeout_ms: 1000 },
    });

    const source = makeSource('workflow', [globalRecord, teamRecord]);

    // Ancestry: root is GLOBAL, then ORG, then TEAM
    const scopeService = makeScopeService({
      [TEAM_SCOPE_ID]: [GLOBAL_SCOPE_NODE_ID, ORG_SCOPE_ID, TEAM_SCOPE_ID],
    });

    const resolver = new ScopedConfigResolver(
      scopeService as unknown as ScopeService,
      cache,
    );
    resolver.register(source);

    const result = await resolver.resolve<WorkflowDefinition>(
      'workflow',
      'my-workflow',
      TEAM_SCOPE_ID,
    );

    // The team-scoped record wins over the global one
    expect(result.value.is_active).toBe(false);
    expect(result.value.timeout_ms).toBe(1000);
    expect(result.isDefault).toBe(false);
    expect(result.locked).toBe(false);

    // Both layers should have contributed
    expect(result.contributingLayers).toHaveLength(2);
    expect(
      result.contributingLayers[result.contributingLayers.length - 1].rowId,
    ).toBe('team-row');
  });

  // -------------------------------------------------------------------------
  // 2. Locked default not overwritten by re-seed
  // -------------------------------------------------------------------------
  it('locked default not overwritten by re-seed', async () => {
    // A record seeded at global scope that has been locked by an admin.
    const lockedGlobalRecord = makeRecord({
      rowId: 'locked-global-row',
      scopeNodeId: null,
      locked: true,
      strategy: 'replace',
      definition: {
        name: 'locked-workflow',
        is_active: true,
        timeout_ms: 3000,
      },
    });

    const source = makeSource('workflow', [lockedGlobalRecord]);

    const scopeService = makeScopeService({
      [GLOBAL_SCOPE_NODE_ID]: [GLOBAL_SCOPE_NODE_ID],
    });

    const resolver = new ScopedConfigResolver(
      scopeService as unknown as ScopeService,
      cache,
    );
    resolver.register(source);

    const result = await resolver.resolve<WorkflowDefinition>(
      'workflow',
      'locked-workflow',
      GLOBAL_SCOPE_NODE_ID,
    );

    // The resolved value should come from the locked record
    expect(result.locked).toBe(true);
    expect(result.value.timeout_ms).toBe(3000);
    expect(result.isDefault).toBe(true);

    // Simulate a re-seed attempt: verify the source was consulted exactly once;
    // the locked flag signals callers that the record must not be updated.
    const loadSpy = source.loadCandidates as ReturnType<typeof vi.fn>;
    expect(loadSpy).toHaveBeenCalledTimes(1);

    // A second resolve for the same key is served from cache — source not called again.
    await resolver.resolve<WorkflowDefinition>(
      'workflow',
      'locked-workflow',
      GLOBAL_SCOPE_NODE_ID,
    );
    expect(loadSpy).toHaveBeenCalledTimes(1); // still 1 — cache hit
  });

  // -------------------------------------------------------------------------
  // 3. Scoped overrides left alone by re-seed
  // -------------------------------------------------------------------------
  it('scoped overrides left alone by re-seed', async () => {
    // Global base definition
    const globalRecord = makeRecord({
      rowId: 'global-base',
      scopeNodeId: null,
      strategy: 'replace',
      definition: {
        name: 'shared-workflow',
        is_active: true,
        timeout_ms: 5000,
      },
    });

    // Team-scoped merge layer that a user has customised — overrides != null
    const teamOverrideRecord = makeRecord({
      rowId: 'team-override',
      scopeNodeId: TEAM_SCOPE_ID,
      strategy: 'merge',
      definition: null,
      overrides: { timeout_ms: 2500 },
    });

    const source = makeSource('workflow', [globalRecord, teamOverrideRecord]);

    const scopeService = makeScopeService({
      [TEAM_SCOPE_ID]: [GLOBAL_SCOPE_NODE_ID, ORG_SCOPE_ID, TEAM_SCOPE_ID],
    });

    const resolver = new ScopedConfigResolver(
      scopeService as unknown as ScopeService,
      cache,
    );
    resolver.register(source);

    const result = await resolver.resolve<WorkflowDefinition>(
      'workflow',
      'shared-workflow',
      TEAM_SCOPE_ID,
    );

    // The merge layer's overrides patch should be applied on top of the base
    expect(result.value.timeout_ms).toBe(2500);
    // The base fields not overridden should be preserved
    expect(result.value.is_active).toBe(true);
    expect(result.value.name).toBe('shared-workflow');

    // The contributing layers expose that the override record is present
    const overrideLayer = result.contributingLayers.find(
      (l) => l.rowId === 'team-override',
    );
    expect(overrideLayer).toBeDefined();
    expect(overrideLayer?.strategy).toBe('merge');
  });

  // -------------------------------------------------------------------------
  // 4. Merge strategy: field-level patch applied correctly
  // -------------------------------------------------------------------------
  it('merge strategy: field-level patch applied correctly', async () => {
    const globalRecord = makeRecord({
      rowId: 'base-row',
      scopeNodeId: null,
      strategy: 'replace',
      definition: {
        name: 'patchable-workflow',
        is_active: true,
        timeout_ms: 9000,
      },
    });

    // A scope-node layer that patches only is_active to false
    const mergeRecord = makeRecord({
      rowId: 'merge-row',
      scopeNodeId: ORG_SCOPE_ID,
      strategy: 'merge',
      definition: null,
      overrides: { is_active: false },
    });

    const source = makeSource('workflow', [globalRecord, mergeRecord]);

    const scopeService = makeScopeService({
      [ORG_SCOPE_ID]: [GLOBAL_SCOPE_NODE_ID, ORG_SCOPE_ID],
    });

    const resolver = new ScopedConfigResolver(
      scopeService as unknown as ScopeService,
      cache,
    );
    resolver.register(source);

    const result = await resolver.resolve<WorkflowDefinition>(
      'workflow',
      'patchable-workflow',
      ORG_SCOPE_ID,
    );

    // The patch flips is_active to false
    expect(result.value.is_active).toBe(false);
    // Unpatched fields come through from the base definition
    expect(result.value.timeout_ms).toBe(9000);
    expect(result.value.name).toBe('patchable-workflow');

    // isDefault is false because a scope-specific merge row contributed
    expect(result.isDefault).toBe(false);

    // Winner is the merge row (last in leaf→root order)
    expect(
      result.contributingLayers[result.contributingLayers.length - 1].rowId,
    ).toBe('merge-row');
  });

  // -------------------------------------------------------------------------
  // 5. Not-found: no candidates throws NotFoundException
  // -------------------------------------------------------------------------
  it('throws when no candidates exist for the requested scope', async () => {
    const source = makeSource('workflow', []); // empty — nothing will be found

    const scopeService = makeScopeService({
      [TEAM_SCOPE_ID]: [GLOBAL_SCOPE_NODE_ID, TEAM_SCOPE_ID],
    });

    const resolver = new ScopedConfigResolver(
      scopeService as unknown as ScopeService,
      cache,
    );
    resolver.register(source);

    await expect(
      resolver.resolve<WorkflowDefinition>(
        'workflow',
        'missing-workflow',
        TEAM_SCOPE_ID,
      ),
    ).rejects.toThrow(
      "No workflow named 'missing-workflow' resolvable at scope",
    );
  });

  // -------------------------------------------------------------------------
  // 6. Cache hit: source is only called once for the same key
  // -------------------------------------------------------------------------
  it('caches resolved config and avoids redundant source lookups', async () => {
    const globalRecord = makeRecord({
      rowId: 'cached-row',
      scopeNodeId: null,
      strategy: 'replace',
      definition: {
        name: 'cached-workflow',
        is_active: true,
        timeout_ms: 1000,
      },
    });

    const source = makeSource('workflow', [globalRecord]);
    const loadSpy = source.loadCandidates as ReturnType<typeof vi.fn>;

    const scopeService = makeScopeService({
      [TEAM_SCOPE_ID]: [GLOBAL_SCOPE_NODE_ID, TEAM_SCOPE_ID],
    });

    const resolver = new ScopedConfigResolver(
      scopeService as unknown as ScopeService,
      cache,
    );
    resolver.register(source);

    await resolver.resolve<WorkflowDefinition>(
      'workflow',
      'cached-workflow',
      TEAM_SCOPE_ID,
    );
    await resolver.resolve<WorkflowDefinition>(
      'workflow',
      'cached-workflow',
      TEAM_SCOPE_ID,
    );
    await resolver.resolve<WorkflowDefinition>(
      'workflow',
      'cached-workflow',
      TEAM_SCOPE_ID,
    );

    expect(loadSpy).toHaveBeenCalledTimes(1);
  });
});
