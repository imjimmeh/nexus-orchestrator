import { Injectable } from '@nestjs/common';
import type { ResolvedVariable } from '@nexus/core';
import { ScopedVariableRepository } from './database/repositories/scoped-variable.repository';
import { ScopeService } from '../scope/scope.service';
import type { ScopedVariable } from './database/entities/scoped-variable.entity';
import { coerceVariableValue } from './coerce-variable.util';
import { expandDottedKeys } from './dotted-keys.util';

@Injectable()
export class VariableResolverService {
  constructor(
    private readonly repository: ScopedVariableRepository,
    private readonly scopeService: ScopeService,
  ) {}

  /**
   * Resolve the effective variables for a scope: the global layer (NULL scope)
   * overlaid by each ancestor scope root->leaf. The leaf-most layer wins.
   */
  async resolveEffective(
    scopeNodeId: string | null,
  ): Promise<ResolvedVariable[]> {
    const globals = await this.repository.findGlobals();

    // key -> { row, layer }. Seed with the global layer first.
    const merged = new Map<string, { row: ScopedVariable; layer: string }>();
    for (const row of globals) {
      merged.set(row.key, { row, layer: 'global' });
    }

    if (scopeNodeId) {
      // root-first, including the node itself; leaf overlays last.
      const ancestry = await this.scopeService.getAncestorIds(scopeNodeId);
      const scopeRows = await this.repository.findByScopeIds(ancestry);
      const orderIndex = new Map(ancestry.map((id, index) => [id, index]));
      const sorted = [...scopeRows].sort(
        (a, b) =>
          (orderIndex.get(a.scope_node_id ?? '') ?? Infinity) -
          (orderIndex.get(b.scope_node_id ?? '') ?? Infinity),
      );
      for (const row of sorted) {
        merged.set(row.key, {
          row,
          layer: row.scope_node_id ?? 'global',
        });
      }
    }

    return [...merged.values()].map(({ row, layer }) => ({
      key: row.key,
      value: coerceVariableValue(row.value, row.value_type),
      type: row.value_type,
      layer,
    }));
  }

  /**
   * Effective variables expanded into a nested object suitable for injection
   * into the Handlebars template context under the `vars` namespace.
   */
  async resolveContext(
    scopeNodeId: string | null,
  ): Promise<Record<string, unknown>> {
    const effective = await this.resolveEffective(scopeNodeId);
    const flat: Record<string, unknown> = {};
    for (const entry of effective) {
      flat[entry.key] = entry.value;
    }
    return expandDottedKeys(flat);
  }
}
