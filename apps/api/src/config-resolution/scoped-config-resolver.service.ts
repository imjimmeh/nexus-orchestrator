import { Injectable, NotFoundException } from '@nestjs/common';
import { ScopeService } from '../scope/scope.service';
import { GLOBAL_SCOPE_NODE_ID } from '../scope/scope.constants';
import type { ConfigObjectType } from './config-resolution.constants';
import type { ScopedConfigSource } from './scoped-config-source';
import type {
  ConfigLayerRecord,
  EffectiveConfig,
} from './effective-config.types';
import { applyOverride } from './override-merge';
import { ConfigResolutionCache } from './config-resolution-cache.service';

@Injectable()
export class ScopedConfigResolver {
  private readonly sources = new Map<
    ConfigObjectType,
    ScopedConfigSource<unknown>
  >();

  constructor(
    private readonly scopeService: ScopeService,
    private readonly cache: ConfigResolutionCache,
  ) {}

  register<T>(source: ScopedConfigSource<T>): void {
    this.sources.set(source.objectType, source);
  }

  async resolve<T>(
    objectType: ConfigObjectType,
    name: string,
    scopeNodeId: string,
  ): Promise<EffectiveConfig<T>> {
    const cached = this.cache.get<T>(objectType, name, scopeNodeId);
    if (cached) return cached;

    const source = this.sources.get(objectType) as
      | ScopedConfigSource<T>
      | undefined;
    if (!source) {
      throw new NotFoundException(
        `No config source registered for object type: ${objectType}`,
      );
    }

    // root→leaf, including the node itself; add GLOBAL as safety net
    const ancestry = await this.scopeService.getAncestorIds(scopeNodeId);
    const scopeIds = Array.from(new Set([GLOBAL_SCOPE_NODE_ID, ...ancestry]));

    const candidates = await source.loadCandidates(name, scopeIds);
    if (candidates.length === 0) {
      throw new NotFoundException(
        `No ${objectType} named '${name}' resolvable at scope ${scopeNodeId}`,
      );
    }

    const resolved = this.reduceLayers<T>(
      objectType,
      name,
      scopeNodeId,
      scopeIds,
      candidates,
    );
    this.cache.set(objectType, name, scopeNodeId, resolved);
    return resolved;
  }

  private reduceLayers<T>(
    objectType: ConfigObjectType,
    name: string,
    scopeNodeId: string,
    scopeIds: string[],
    candidates: Array<ConfigLayerRecord<T>>,
  ): EffectiveConfig<T> {
    const normalizeScope = (s: string | null): string =>
      s ?? GLOBAL_SCOPE_NODE_ID;
    const specificity = (row: ConfigLayerRecord<T>): number =>
      scopeIds.indexOf(normalizeScope(row.scopeNodeId));
    const ordered = [...candidates]
      .filter((r) => specificity(r) >= 0)
      .sort((a, b) => specificity(a) - specificity(b)); // root→leaf

    let value: T | null = null;
    const contributingLayers: EffectiveConfig<T>['contributingLayers'] = [];

    for (const row of ordered) {
      value = applyOverride<T>(value, {
        strategy: row.strategy,
        definition: row.definition,
        overrides: row.overrides,
      });
      contributingLayers.push({
        rowId: row.rowId,
        scopeNodeId: row.scopeNodeId,
        source: row.source,
        strategy: row.strategy,
      });
    }

    if (value === null) {
      throw new NotFoundException(
        `Unresolvable ${objectType} '${name}' at scope ${scopeNodeId}`,
      );
    }

    const winner = ordered[ordered.length - 1];
    return {
      objectType,
      name,
      scopeNodeId,
      value,
      contributingLayers,
      isDefault: ordered.every(
        (r) => normalizeScope(r.scopeNodeId) === GLOBAL_SCOPE_NODE_ID,
      ),
      locked: winner.locked,
    };
  }
}
