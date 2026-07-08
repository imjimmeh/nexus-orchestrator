import { Injectable } from '@nestjs/common';
import { ScopeService } from '../../scope/scope.service';
import { DataSource } from 'typeorm';
import { GITOPS_MANAGED_BY } from '../gitops.constants';
import type { ScopeNodeType } from '../../scope/scope.constants.types';
import type {
  GitOpsApplyContext,
  GitOpsEditPolicyContext,
  GitOpsEditPolicyResult,
  GitOpsNormalizedObject,
  GitOpsObjectHandler,
  GitOpsObjectPlan,
  GitOpsPlanInput,
  GitOpsSerializedObject,
} from './gitops-object-handler.types';

interface ScopeNodeRow {
  id: string;
  parent_id: string | null;
  type: string;
  name: string;
  slug: string;
  managed_by: string | null;
  locked: boolean;
}

interface ScopeTreeNodeLike {
  id: string;
  slug: string;
  children: ScopeTreeNodeLike[];
}

interface ScopeNodeDesiredInput {
  key: string;
  objectType: 'scope_node';
  fields: {
    type: ScopeNodeType;
    name: string;
    slug: string;
    metadata?: Record<string, unknown> | null;
  };
}

const SCOPE_NODE_ALLOWED_COLUMNS = new Set([
  'name',
  'slug',
  'type',
  'parent_id',
  'metadata',
]);

@Injectable()
export class ScopeNodeGitopsHandler implements GitOpsObjectHandler<ScopeNodeDesiredInput> {
  readonly objectType = 'scope_node' as const;

  constructor(
    private readonly dataSource: DataSource,
    private readonly scope: ScopeService,
  ) {}

  async readActual(scopeNodeId: string): Promise<GitOpsSerializedObject[]> {
    const ids = await this.scope.getDescendantIds(scopeNodeId);
    if (ids.length === 0) {
      return [];
    }

    const rows: ScopeNodeRow[] = await this.dataSource.query(
      `SELECT id, parent_id, type, name, slug, managed_by, locked FROM scope_nodes WHERE id = ANY($1)`,
      [ids],
    );
    const idToPath = this.buildIdToPathMap(rows);

    return rows.map((row) => this.serialize(this.toActual(row, idToPath)));
  }

  normalizeDesired(input: ScopeNodeDesiredInput): GitOpsNormalizedObject {
    return {
      objectType: this.objectType,
      key: input.key,
      fields: { ...input.fields },
    };
  }

  plan(
    change: GitOpsPlanInput<ScopeNodeDesiredInput>,
  ): GitOpsObjectPlan<ScopeNodeDesiredInput> {
    if (!change.actual) {
      return {
        objectType: this.objectType,
        key: change.desired?.key ?? '',
        op: 'create',
        desired: change.desired,
        actual: null,
      };
    }

    if (!change.desired) {
      return {
        objectType: this.objectType,
        key: change.actual.key,
        op: 'delete',
        desired: null,
        actual: change.actual,
      };
    }

    const diff = this.diffFields(change.actual.fields, change.desired.fields);
    return {
      objectType: this.objectType,
      key: change.desired.key,
      op: Object.keys(diff).length === 0 ? 'noop' : 'update',
      desired: change.desired,
      actual: change.actual,
      diff,
    };
  }

  async apply(
    change: GitOpsObjectPlan<ScopeNodeDesiredInput>,
    context: GitOpsApplyContext,
  ): Promise<void> {
    if (change.op === 'noop') {
      return;
    }

    if (change.op === 'create' && change.desired) {
      const parentId = await this.resolveParentId(change.desired.key);
      const created = await this.scope.createNode({
        parentId,
        type: change.desired.fields.type,
        name: change.desired.fields.name,
        slug: change.desired.fields.slug,
        metadata: change.desired.fields.metadata ?? null,
        actorId: context.actorId,
      });
      await context.manager.query(
        `UPDATE scope_nodes SET managed_by = $1 WHERE id = $2`,
        [GITOPS_MANAGED_BY, created.id],
      );
      return;
    }

    if (change.op === 'delete') {
      const dbId = change.actual?.fields['id'] as string | undefined;
      if (!dbId) {
        return;
      }
      await context.manager.query(
        `DELETE FROM scope_nodes WHERE id = $1 AND managed_by = $2`,
        [dbId, GITOPS_MANAGED_BY],
      );
      return;
    }

    if (change.op === 'update' && change.actual && change.diff) {
      const dbId = change.actual.fields['id'] as string | undefined;
      if (!dbId) {
        return;
      }

      const pairs = Object.entries(change.diff)
        .map(
          ([field, value]) =>
            [this.toColumn(field), value.to] as [string, unknown],
        )
        .filter(([column]) => SCOPE_NODE_ALLOWED_COLUMNS.has(column));

      if (pairs.length === 0) {
        return;
      }

      const sets = pairs
        .map(([column], index) => `${column} = $${index + 2}`)
        .join(', ');
      await context.manager.query(
        `UPDATE scope_nodes SET ${sets}, managed_by = $${pairs.length + 2} WHERE id = $1`,
        [dbId, ...pairs.map(([, value]) => value), GITOPS_MANAGED_BY],
      );
    }
  }

  serialize(actual: GitOpsSerializedObject): GitOpsSerializedObject {
    return {
      objectType: this.objectType,
      key: actual.key,
      fields: { ...actual.fields },
      managedBy: actual.managedBy,
      locked: actual.locked,
    };
  }

  canEdit(context: GitOpsEditPolicyContext): GitOpsEditPolicyResult {
    if (context.locked) {
      return { allowed: false, reason: 'object is locked' };
    }

    if (context.managedBy !== GITOPS_MANAGED_BY) {
      return { allowed: false, reason: 'object is not gitops-managed' };
    }

    return { allowed: true };
  }

  private buildIdToPathMap(rows: ScopeNodeRow[]): Map<string, string> {
    const byId = new Map<string, ScopeNodeRow>();
    for (const row of rows) {
      byId.set(row.id, row);
    }

    const cache = new Map<string, string>();
    const pathOf = (id: string): string => {
      const cached = cache.get(id);
      if (cached !== undefined) {
        return cached;
      }

      const row = byId.get(id);
      if (!row) {
        return `/${id}`;
      }

      const parentPath = row.parent_id ? pathOf(row.parent_id) : '/';
      const nextPath =
        parentPath === '/' ? `/${row.slug}` : `${parentPath}/${row.slug}`;
      cache.set(id, nextPath);
      return nextPath;
    };

    const idToPath = new Map<string, string>();
    for (const row of rows) {
      idToPath.set(row.id, pathOf(row.id));
    }
    return idToPath;
  }

  private toActual(
    row: ScopeNodeRow,
    idToPath: Map<string, string>,
  ): GitOpsSerializedObject {
    const path = idToPath.get(row.id) ?? `/${row.id}`;
    return {
      objectType: this.objectType,
      key: path,
      fields: {
        id: row.id,
        type: row.type,
        name: row.name,
        slug: row.slug,
        parentId: row.parent_id,
        path,
      },
      managedBy: row.managed_by,
      locked: row.locked,
    };
  }

  private diffFields(
    from: Record<string, unknown>,
    to: Record<string, unknown>,
  ): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(to)) {
      if (JSON.stringify(from[key]) !== JSON.stringify(to[key])) {
        diff[key] = { from: from[key], to: to[key] };
      }
    }
    return diff;
  }

  private async resolveParentId(scopePath: string): Promise<string | null> {
    const normalized = scopePath.replace(/^\/+|\/+$/g, '');
    if (!normalized) {
      return null;
    }

    const segments = normalized.split('/');
    if (segments.length <= 1) {
      return this.getRootNodeId();
    }

    const parentPath = `/${segments.slice(0, -1).join('/')}`;
    return this.findScopeNodeIdByPath(parentPath);
  }

  private async getRootNodeId(): Promise<string | null> {
    const tree = await this.scope.getTree();
    return tree?.id ?? null;
  }

  private async findScopeNodeIdByPath(
    pathValue: string,
  ): Promise<string | null> {
    const tree = (await this.scope.getTree()) as ScopeTreeNodeLike | null;
    if (!tree) {
      return null;
    }

    const segments = pathValue.split('/').filter(Boolean);
    let current: ScopeTreeNodeLike | null = tree;

    for (const segment of segments) {
      current =
        (current?.children ?? []).find((child) => child.slug === segment) ??
        null;
      if (!current) {
        return null;
      }
    }

    return current.id;
  }

  private toColumn(field: string): string {
    return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  }
}
