import { Injectable } from '@nestjs/common';
import { ScopedAiDefaultRepository } from './scoped-ai-default.repository.js';
import { ScopeService } from '../scope/scope.service.js';

interface ResolvedScopedAiDefault {
  harnessId?: string;
  modelName?: string;
  providerName?: string;
}

interface ScopedDefaultRow {
  scopeNodeId: string | null;
  harnessId?: string | null;
  modelName?: string | null;
  providerName?: string | null;
}

@Injectable()
export class ScopedAiDefaultResolver {
  constructor(
    private readonly repo: ScopedAiDefaultRepository,
    private readonly scope: ScopeService,
  ) {}

  /**
   * Resolves scoped defaults with field-level precedence: most-specific scope
   * → ancestors → platform (NULL). The first non-null value per field wins.
   */
  async resolve(scopeNodeId?: string): Promise<ResolvedScopedAiDefault> {
    const orderedRows = await this.collectRowsMostSpecificFirst(scopeNodeId);
    return {
      harnessId: this.firstNonNull(orderedRows, 'harnessId'),
      modelName: this.firstNonNull(orderedRows, 'modelName'),
      providerName: this.firstNonNull(orderedRows, 'providerName'),
    };
  }

  private async collectRowsMostSpecificFirst(
    scopeNodeId?: string,
  ): Promise<ScopedDefaultRow[]> {
    const rows: ScopedDefaultRow[] = [];
    if (scopeNodeId) {
      // getAncestorIds: root-first incl self → reverse for most-specific first.
      const ancestorIdsRootFirst = await this.scope.getAncestorIds(scopeNodeId);
      const mostSpecificFirst = [...ancestorIdsRootFirst].reverse();
      const scopedRows = await this.repo.findForScopeIds(mostSpecificFirst);
      const byScope = new Map(scopedRows.map((r) => [r.scopeNodeId, r]));
      for (const id of mostSpecificFirst) {
        const row = byScope.get(id);
        if (row) rows.push(row);
      }
    }
    const platform = await this.repo.getForScope(null);
    if (platform) rows.push(platform);
    return rows;
  }

  private firstNonNull(
    rows: ScopedDefaultRow[],
    field: 'harnessId' | 'modelName' | 'providerName',
  ): string | undefined {
    for (const row of rows) {
      const value = row[field];
      if (value != null && value !== '') return value;
    }
    return undefined;
  }
}
