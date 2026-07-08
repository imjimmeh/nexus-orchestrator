import { Injectable, Logger } from '@nestjs/common';
import type { GitOpsSyncableObjectType } from '@nexus/core';
import { DataSource, EntityManager } from 'typeorm';
import { AuditLogRepository } from '../audit/database/repositories/audit-log.repository';
import { ScopeService } from '../scope/scope.service';
import { GITOPS_MANAGED_BY, reconcileKey } from './gitops.constants';
import { GitOpsObjectRegistryService } from './objects/gitops-object-registry.service';
import type {
  ReconcileChange,
  ReconciliationPlan,
} from './reconciliation.types';
import type {
  ApplyOptions,
  ApplyResult,
} from './reconciliation-apply.service.types';
import type { ScopeNodeType } from '../scope/scope.constants.types';

const GITOPS_AUDIT_EVENT = 'GitOpsReconcile';

const SCOPE_NODE_ALLOWED_COLUMNS = new Set([
  'name',
  'slug',
  'type',
  'parent_id',
  'metadata',
]);
const ROLE_ALLOWED_COLUMNS = new Set(['description', 'name']);

@Injectable()
export class ReconciliationApplyService {
  private readonly logger = new Logger(ReconciliationApplyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditLogRepository,
    private readonly scope: ScopeService,
    private readonly registry: GitOpsObjectRegistryService,
  ) {}

  async apply(
    plan: ReconciliationPlan,
    options: ApplyOptions,
  ): Promise<ApplyResult> {
    const actionable = plan.changes.filter((c) => c.op !== 'noop');
    const skipped = plan.changes.length - actionable.length;

    if (options.dryRun) {
      return { planned: actionable.length, applied: 0, skipped, dryRun: true };
    }

    let applied = 0;
    await this.dataSource.transaction(async (m: EntityManager) => {
      for (const change of actionable) {
        await this.applyChange(m, change, options);
        await this.audit.log({
          event_type: GITOPS_AUDIT_EVENT,
          actor_id: options.actorId,
          resource_id: reconcileKey(change.type, change.key),
          action: change.op,
          result: 'success',
          metadata: {
            type: change.type,
            key: change.key,
            diff: change.diff ?? null,
          },
        });
        applied += 1;
      }
    });

    return { planned: actionable.length, applied, skipped, dryRun: false };
  }

  private async applyChange(
    m: EntityManager,
    change: ReconcileChange,
    options: ApplyOptions,
  ): Promise<void> {
    switch (change.type) {
      case 'scope_node':
        return this.applyScopeNode(m, change, options);
      case 'role':
        return this.applyRole(m, change, options);
      case 'role_assignment':
        return this.applyAssignment(m, change, options);
      case 'workflow':
        return this.applyRegistryObject(
          m,
          { ...change, type: 'workflow' },
          options,
        );
      case 'agent_profile':
        return this.applyRegistryObject(
          m,
          { ...change, type: 'agent_profile' },
          options,
        );
      case 'skill':
        return this.applyRegistryObject(
          m,
          { ...change, type: 'skill' },
          options,
        );
      case 'config_override':
        return this.applyOverride(m, change, options);
    }
  }

  private async applyScopeNode(
    m: EntityManager,
    change: ReconcileChange,
    options: ApplyOptions,
  ): Promise<void> {
    const key = reconcileKey(change.type, change.key);
    const fields = options.desiredObjects.get(key) ?? {};

    if (change.op === 'create') {
      return this.createScopeNode(m, change.key, fields);
    }

    if (change.op === 'delete') {
      return this.deleteScopeNode(
        m,
        change.key,
        options.actualObjects?.get(key),
      );
    }

    if (change.op === 'update' && change.diff) {
      await this.updateScopeNode(
        m,
        change.key,
        change.diff,
        options.actualObjects?.get(key),
      );
    }
  }

  private async createScopeNode(
    m: EntityManager,
    key: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const created = await this.scope.createNode({
      parentId: (fields['parentId'] as string | null) ?? null,
      type: (fields['type'] as ScopeNodeType | null | undefined) ?? 'org',
      name: (fields['name'] as string | null | undefined) ?? key,
      slug:
        (fields['slug'] as string | null | undefined) ??
        key.replace(/^.*\//, ''),
      metadata: null,
    });
    // Tag as gitops-managed; CreateScopeNodeInput has no managedBy field.
    await m.query(`UPDATE scope_nodes SET managed_by = $1 WHERE id = $2`, [
      GITOPS_MANAGED_BY,
      created.id,
    ]);
  }

  private async deleteScopeNode(
    m: EntityManager,
    key: string,
    actualEntry: { fields: Record<string, unknown> } | undefined,
  ): Promise<void> {
    const dbId = actualEntry?.fields['id'] as string | undefined;
    if (!dbId) {
      this.logger.warn(
        `Cannot delete scope_node ${key}: no DB id in actual state`,
      );
      return;
    }
    await m.query(`DELETE FROM scope_nodes WHERE id = $1 AND managed_by = $2`, [
      dbId,
      GITOPS_MANAGED_BY,
    ]);
  }

  private async updateScopeNode(
    m: EntityManager,
    key: string,
    diff: NonNullable<ReconcileChange['diff']>,
    actualEntry: { fields: Record<string, unknown> } | undefined,
  ): Promise<void> {
    const dbId = actualEntry?.fields['id'] as string | undefined;
    if (!dbId) {
      this.logger.warn(
        `Cannot update scope_node ${key}: no DB id in actual state`,
      );
      return;
    }
    const pairs = Object.entries(diff)
      .map(([f, v]) => [this.toColumn(f), v.to] as [string, unknown])
      .filter(([col]) => SCOPE_NODE_ALLOWED_COLUMNS.has(col));
    if (pairs.length === 0) return;
    const sets = pairs.map(([col], i) => `${col} = $${i + 2}`).join(', ');
    const managedByParam = pairs.length + 2;
    await m.query(
      `UPDATE scope_nodes SET ${sets}, managed_by = $${managedByParam} WHERE id = $1`,
      [dbId, ...pairs.map(([, v]) => v), GITOPS_MANAGED_BY],
    );
  }

  private async applyRole(
    m: EntityManager,
    change: ReconcileChange,
    options: ApplyOptions,
  ): Promise<void> {
    const fields =
      options.desiredObjects.get(reconcileKey(change.type, change.key)) ?? {};

    if (change.op === 'create') {
      await m.query(
        `INSERT INTO roles (name, description, managed_by) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`,
        [change.key, fields['description'] ?? '', GITOPS_MANAGED_BY],
      );
    } else if (change.op === 'update' && change.diff) {
      const pairs = Object.entries(change.diff ?? {})
        .map(([f, v]) => [this.toColumn(f), v.to] as [string, unknown])
        .filter(([col]) => ROLE_ALLOWED_COLUMNS.has(col));
      if (pairs.length === 0) return;
      const sets = pairs.map(([col], i) => `${col} = $${i + 2}`).join(', ');
      await m.query(`UPDATE roles SET ${sets} WHERE name = $1`, [
        change.key,
        ...pairs.map(([, v]) => v),
      ]);
    } else if (change.op === 'delete') {
      await m.query(`DELETE FROM roles WHERE name = $1 AND managed_by = $2`, [
        change.key,
        GITOPS_MANAGED_BY,
      ]);
    }
  }

  private applyAssignment(
    m: EntityManager,
    change: ReconcileChange,
    options: ApplyOptions,
  ): Promise<void> {
    const handler = this.registry.getHandler('role_assignment');
    const key = reconcileKey(change.type, change.key);
    const desiredFields = options.desiredObjects.get(key) ?? null;
    const actual = options.actualObjects?.get(key) ?? null;

    const desired =
      change.op === 'delete' || !desiredFields
        ? null
        : {
            objectType: 'role_assignment' as const,
            key: change.key,
            fields: desiredFields,
          };

    const planActual = actual
      ? {
          objectType: 'role_assignment' as const,
          key: change.key,
          fields: actual.fields,
          managedBy: actual.managedBy,
          locked: actual.locked,
        }
      : null;

    return handler.apply(
      {
        objectType: 'role_assignment',
        key: change.key,
        op: change.op,
        desired,
        actual: planActual,
        diff: change.diff,
      },
      { actorId: options.actorId, manager: m },
    );
  }

  private applyRegistryObject(
    m: EntityManager,
    change: ReconcileChange & { type: GitOpsSyncableObjectType },
    options: ApplyOptions,
  ): Promise<void> {
    const handler = this.registry.getHandler(change.type);
    const key = reconcileKey(change.type, change.key);
    const desiredFields = options.desiredObjects.get(key) ?? null;
    const actual = options.actualObjects?.get(key) ?? null;

    return handler.apply(
      {
        objectType: change.type,
        key: change.key,
        op: change.op,
        desired:
          change.op === 'delete' || !desiredFields
            ? null
            : {
                objectType: change.type,
                key: change.key,
                fields: desiredFields,
              },
        actual: actual
          ? {
              objectType: change.type,
              key: change.key,
              fields: actual.fields,
              managedBy: actual.managedBy,
              locked: actual.locked,
            }
          : null,
        diff: change.diff,
      },
      {
        actorId: options.actorId,
        manager: m,
        bindingId: options.bindingId,
        conflictPolicy: options.conflictPolicy,
      },
    );
  }

  private applyOverride(
    _m: EntityManager,
    change: ReconcileChange,
    _options: ApplyOptions,
  ): never {
    throw new Error(
      `config_override apply not yet implemented for key: ${change.key}`,
    );
  }

  /** Converts a camelCase field name to snake_case for SQL column assignment. */
  private toColumn(field: string): string {
    return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  }
}
