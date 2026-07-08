import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScopeService } from '../../scope/scope.service';
import { GITOPS_MANAGED_BY } from '../gitops.constants';
import {
  buildScopePathById,
  diffFields,
  resolveNameFromKey,
  resolveScopeNodeId,
  requireGitOpsBindingId,
} from './gitops-object.helpers';
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

type WorkflowSource = 'seeded' | 'admin' | 'repository';
type WorkflowStrategy = 'merge' | 'replace';

interface WorkflowRow {
  id: string;
  name: string;
  yaml_definition: string;
  is_active: boolean;
  source: WorkflowSource;
  locked: boolean;
  scope_node_id: string | null;
  managed_by: string | null;
  managed_binding_id: string | null;
  managed_revision: string | null;
  last_git_hash: string | null;
  sync_state: string | null;
  overrides: Record<string, unknown> | null;
  base_ref: string | null;
  base_workflow_id: string | null;
}

interface WorkflowDesiredInput {
  key: string;
  objectType: 'workflow';
  fields: {
    name?: string;
    scope?: string | null;
    strategy?: WorkflowStrategy;
    definition?: string;
    overrides?: Record<string, unknown> | null;
    source?: WorkflowSource;
    locked?: boolean;
    managedBindingId?: string | null;
    managedRevision?: string | null;
    lastGitHash?: string | null;
    syncState?: string | null;
    baseRef?: string | null;
    baseWorkflowId?: string | null;
  };
}

@Injectable()
export class WorkflowGitopsHandler implements GitOpsObjectHandler<WorkflowDesiredInput> {
  readonly objectType = 'workflow' as const;

  constructor(
    private readonly dataSource: DataSource,
    private readonly scope: ScopeService,
  ) {}

  async readActual(scopeNodeId: string): Promise<GitOpsSerializedObject[]> {
    const descendantIds = await this.scope.getDescendantIds(scopeNodeId);
    const scopeIds = [...new Set([scopeNodeId, ...descendantIds])];

    const rows: WorkflowRow[] = await this.dataSource.query(
      `SELECT id, name, yaml_definition, is_active, source, locked, scope_node_id, managed_by, managed_binding_id, managed_revision, last_git_hash, sync_state, overrides, base_ref, base_workflow_id
       FROM workflows
       WHERE scope_node_id = ANY($1) AND is_active = true`,
      [scopeIds],
    );

    const scopePathById = await buildScopePathById(this.scope);
    return rows.map((row) => this.serialize(this.toActual(row, scopePathById)));
  }

  normalizeDesired(input: WorkflowDesiredInput): GitOpsNormalizedObject {
    return {
      objectType: this.objectType,
      key: input.key,
      fields: { ...input.fields },
    };
  }

  plan(
    change: GitOpsPlanInput<WorkflowDesiredInput>,
  ): GitOpsObjectPlan<WorkflowDesiredInput> {
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

    const diff = diffFields(change.actual.fields, change.desired.fields);
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
    change: GitOpsObjectPlan<WorkflowDesiredInput>,
    context: GitOpsApplyContext,
  ): Promise<void> {
    if (change.op === 'noop') {
      return;
    }

    if (change.op === 'create' && change.desired) {
      await this.applyCreate(change.desired, context);
      return;
    }

    if (change.op === 'delete') {
      await this.applyDelete(change, context);
      return;
    }

    if (change.op === 'update' && change.desired) {
      await this.applyUpdate(change.desired, context);
    }
  }

  private async applyCreate(
    desired: WorkflowDesiredInput,
    context: GitOpsApplyContext,
  ): Promise<void> {
    const resolved = await this.resolveDesired(desired);
    const bindingId = requireGitOpsBindingId(context.bindingId);
    await context.manager.query(
      `INSERT INTO workflows (
        name,
        yaml_definition,
        scope_node_id,
        source,
        locked,
        overrides,
        base_ref,
        base_workflow_id,
        managed_by,
        managed_binding_id,
        managed_revision,
        last_git_hash,
        sync_state,
        is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true)
      ON CONFLICT (name, scope_node_id) DO NOTHING`,
      [
        resolved.name,
        resolved.definition,
        resolved.scopeNodeId,
        resolved.source,
        resolved.locked,
        resolved.overrides,
        resolved.baseRef,
        resolved.baseWorkflowId,
        GITOPS_MANAGED_BY,
        bindingId,
        resolved.managedRevision,
        resolved.lastGitHash,
        resolved.syncState,
      ],
    );
  }

  private async applyDelete(
    change: GitOpsObjectPlan<WorkflowDesiredInput>,
    context: GitOpsApplyContext,
  ): Promise<void> {
    const actual = change.actual;
    if (!actual) {
      return;
    }

    const scopeNodeId = await resolveScopeNodeId(
      this.scope,
      actual.fields['scope'] as string | null | undefined,
    );
    const name = (actual.fields['name'] as string | undefined) ?? change.key;
    const bindingId = requireGitOpsBindingId(context.bindingId);
    await context.manager.query(
      `UPDATE workflows
       SET is_active = false, managed_by = $3
       WHERE name = $1
         AND scope_node_id IS NOT DISTINCT FROM $2
         AND managed_by = $3${bindingId ? ' AND managed_binding_id = $4' : bindingId === null ? ' AND managed_binding_id IS NULL' : ''}`,
      bindingId
        ? [name, scopeNodeId, GITOPS_MANAGED_BY, bindingId]
        : [name, scopeNodeId, GITOPS_MANAGED_BY],
    );
  }

  private async applyUpdate(
    desired: WorkflowDesiredInput,
    context: GitOpsApplyContext,
  ): Promise<void> {
    const resolved = await this.resolveDesired(desired);
    const bindingId = requireGitOpsBindingId(context.bindingId);
    const assignments = this.buildUpdateAssignments(resolved, bindingId);

    const sets = assignments
      .map(([column], index) => `${column} = $${index + 4}`)
      .join(', ');
    const bindingClause =
      bindingId !== null
        ? ` AND managed_binding_id = $${assignments.length + 4}`
        : ' AND managed_binding_id IS NULL';
    const params = [
      resolved.name,
      resolved.scopeNodeId,
      GITOPS_MANAGED_BY,
      ...assignments.map(([, value]) => value),
    ];
    if (bindingId !== null) {
      params.push(bindingId);
    }

    await context.manager.query(
      `UPDATE workflows
       SET ${sets}
       WHERE name = $1
         AND scope_node_id IS NOT DISTINCT FROM $2
         AND managed_by = $3${bindingClause}`,
      params,
    );
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

  private toActual(
    row: WorkflowRow,
    scopePathById: Map<string, string>,
  ): GitOpsSerializedObject {
    const scopePath =
      row.scope_node_id === null
        ? null
        : (scopePathById.get(row.scope_node_id) ?? `/${row.scope_node_id}`);
    const key = scopePath ? `${scopePath}:${row.name}` : row.name;

    return {
      objectType: this.objectType,
      key,
      fields: {
        name: row.name,
        scope: scopePath,
        strategy: this.resolveStrategy(row),
        definition: row.yaml_definition,
        overrides: row.overrides,
        source: row.source,
        locked: row.locked,
        managedBindingId: row.managed_binding_id,
        managedRevision: row.managed_revision,
        lastGitHash: row.last_git_hash,
        syncState: row.sync_state,
        baseRef: row.base_ref,
        baseWorkflowId: row.base_workflow_id,
      },
      managedBy: row.managed_by,
      locked: row.locked,
    };
  }

  private async resolveDesired(input: WorkflowDesiredInput): Promise<{
    name: string;
    scopeNodeId: string | null;
    strategy: WorkflowStrategy;
    definition: string;
    overrides: Record<string, unknown> | null;
    source: WorkflowSource;
    locked: boolean;
    managedBindingId: string | null;
    managedRevision: string | null;
    lastGitHash: string | null;
    syncState: string | null;
    baseRef: string | null;
    baseWorkflowId: string | null;
  }> {
    const name = input.fields.name ?? resolveNameFromKey(input.key);
    return {
      name,
      strategy: this.resolveDesiredStrategy(input.fields),
      scopeNodeId: await resolveScopeNodeId(
        this.scope,
        input.fields.scope ?? null,
      ),
      definition: input.fields.definition ?? '',
      overrides: input.fields.overrides ?? null,
      source: 'repository',
      locked: input.fields.locked ?? false,
      managedBindingId: input.fields.managedBindingId ?? null,
      managedRevision: input.fields.managedRevision ?? null,
      lastGitHash: input.fields.lastGitHash ?? null,
      syncState: input.fields.syncState ?? null,
      baseRef: input.fields.baseRef ?? null,
      baseWorkflowId: input.fields.baseWorkflowId ?? null,
    };
  }

  private buildUpdateAssignments(
    resolved: {
      strategy: WorkflowStrategy;
      definition: string;
      overrides: Record<string, unknown> | null;
      source: WorkflowSource;
      locked: boolean;
      baseRef: string | null;
      baseWorkflowId: string | null;
      managedRevision: string | null;
      lastGitHash: string | null;
      syncState: string | null;
    },
    bindingId: string | null,
  ): Array<[string, unknown]> {
    const shared: Array<[string, unknown]> = [
      ['source', 'repository'],
      ['locked', resolved.locked],
      ['managed_revision', resolved.managedRevision],
      ['last_git_hash', resolved.lastGitHash],
      ['sync_state', resolved.syncState],
      ['managed_binding_id', bindingId],
    ];

    if (resolved.strategy === 'merge') {
      return [
        ...shared,
        ['overrides', resolved.overrides],
        ['base_ref', resolved.baseRef],
        ['base_workflow_id', resolved.baseWorkflowId],
      ];
    }

    return [
      ['yaml_definition', resolved.definition],
      ...shared,
      ['overrides', null],
      ['base_ref', null],
      ['base_workflow_id', null],
    ];
  }

  private resolveDesiredStrategy(
    fields: WorkflowDesiredInput['fields'],
  ): WorkflowStrategy {
    if (fields.strategy) {
      return fields.strategy;
    }

    return fields.overrides || fields.baseRef ? 'merge' : 'replace';
  }

  private resolveStrategy(row: WorkflowRow): WorkflowStrategy {
    return row.overrides || row.base_ref ? 'merge' : 'replace';
  }
}
