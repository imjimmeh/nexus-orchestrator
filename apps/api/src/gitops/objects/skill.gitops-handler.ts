import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScopeService } from '../../scope/scope.service';
import { GITOPS_MANAGED_BY } from '../gitops.constants';
import {
  buildScopePathById,
  diffFields,
  fromDbArray,
  resolveNameFromKey,
  resolveScopeNodeId,
  requireGitOpsBindingId,
  toDbArray,
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

type SkillSource = 'imported' | 'admin' | 'agent_factory' | 'repository';
type SkillStrategy = 'merge' | 'replace';

interface SkillRow {
  name: string;
  description: string;
  skill_markdown: string;
  category: string | null;
  tags: string | null;
  metadata: Record<string, unknown> | null;
  scope_node_id: string | null;
  source: SkillSource;
  locked: boolean;
  version: number;
  overrides: Record<string, unknown> | null;
  base_ref: string | null;
  managed_by: string | null;
  managed_binding_id: string | null;
  managed_revision: string | null;
  last_git_hash: string | null;
  sync_state: string | null;
}

interface SkillDesiredInput {
  key: string;
  objectType: 'skill';
  fields: {
    name?: string;
    scope?: string | null;
    strategy?: SkillStrategy;
    description?: string;
    skillMarkdown?: string;
    category?: string | null;
    tags?: string[] | null;
    metadata?: Record<string, unknown> | null;
    version?: number;
    source?: SkillSource;
    locked?: boolean;
    overrides?: Record<string, unknown> | null;
    baseRef?: string | null;
    managedBindingId?: string | null;
    managedRevision?: string | null;
    lastGitHash?: string | null;
    syncState?: string | null;
  };
}

function buildAssignments(
  resolved: {
    strategy: SkillStrategy;
    description: string;
    skillMarkdown: string;
    category: string | null;
    tags: string[] | null;
    metadata: Record<string, unknown> | null;
    version: number;
    source: SkillSource;
    locked: boolean;
    overrides: Record<string, unknown> | null;
    baseRef: string | null;
    managedRevision: string | null;
    lastGitHash: string | null;
    syncState: string | null;
  },
  managedBindingId: string | null,
): Array<[string, unknown]> {
  const shared: Array<[string, unknown]> = [
    ['source', 'repository'],
    ['locked', resolved.locked],
    ['managed_revision', resolved.managedRevision],
    ['last_git_hash', resolved.lastGitHash],
    ['sync_state', resolved.syncState],
    ['managed_binding_id', managedBindingId],
  ];

  if (resolved.strategy === 'merge') {
    return [
      ...shared,
      ['overrides', resolved.overrides],
      ['base_ref', resolved.baseRef],
    ];
  }

  return [
    ['description', resolved.description],
    ['skill_markdown', resolved.skillMarkdown],
    ['category', resolved.category],
    ['tags', toDbArray(resolved.tags)],
    ['metadata', resolved.metadata],
    ['version', resolved.version],
    ...shared,
    ['overrides', null],
    ['base_ref', null],
  ];
}

@Injectable()
export class SkillGitopsHandler implements GitOpsObjectHandler<SkillDesiredInput> {
  readonly objectType = 'skill' as const;

  constructor(
    private readonly dataSource: DataSource,
    private readonly scope: ScopeService,
  ) {}

  async readActual(scopeNodeId: string): Promise<GitOpsSerializedObject[]> {
    const scopeIds = [
      scopeNodeId,
      ...(await this.scope.getDescendantIds(scopeNodeId)),
    ];
    const rows: SkillRow[] = await this.dataSource.query(
      `SELECT name, description, skill_markdown, category, tags, metadata, scope_node_id, source, locked, version, overrides, base_ref, managed_by, managed_binding_id, managed_revision, last_git_hash, sync_state
       FROM skills
       WHERE scope_node_id = ANY($1) AND is_active = true`,
      [scopeIds],
    );

    const scopePathById = await buildScopePathById(this.scope);
    return rows.map((row) => this.serialize(this.toActual(row, scopePathById)));
  }

  normalizeDesired(input: SkillDesiredInput): GitOpsNormalizedObject {
    return {
      objectType: this.objectType,
      key: input.key,
      fields: { ...input.fields },
    };
  }

  plan(
    change: GitOpsPlanInput<SkillDesiredInput>,
  ): GitOpsObjectPlan<SkillDesiredInput> {
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
    change: GitOpsObjectPlan<SkillDesiredInput>,
    context: GitOpsApplyContext,
  ): Promise<void> {
    if (change.op === 'noop') return;

    if (change.op === 'create' && change.desired) {
      await this.applyCreate(change.desired, context);
      return;
    }

    if (change.op === 'delete' && change.actual) {
      await this.applyDelete(change, context);
      return;
    }

    if (change.op === 'update' && change.desired) {
      await this.applyUpdate(change.desired, context);
    }
  }

  private async applyCreate(
    desired: SkillDesiredInput,
    context: GitOpsApplyContext,
  ): Promise<void> {
    const resolved = await this.resolveDesired(desired);
    const bindingId = requireGitOpsBindingId(context.bindingId);
    await context.manager.query(
      `INSERT INTO skills (
        name, description, skill_markdown, category, tags, metadata, scope_node_id, source,
        locked, version, is_active, overrides, base_ref, managed_by, managed_binding_id,
        managed_revision, last_git_hash, sync_state
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (name, scope_node_id) DO NOTHING`,
      [
        resolved.name,
        resolved.description,
        resolved.skillMarkdown,
        resolved.category,
        toDbArray(resolved.tags),
        resolved.metadata,
        resolved.scopeNodeId,
        'repository',
        resolved.locked,
        resolved.version,
        resolved.overrides,
        resolved.baseRef,
        GITOPS_MANAGED_BY,
        bindingId,
        resolved.managedRevision,
        resolved.lastGitHash,
        resolved.syncState,
      ],
    );
  }

  private async applyDelete(
    change: GitOpsObjectPlan<SkillDesiredInput>,
    context: GitOpsApplyContext,
  ): Promise<void> {
    const name =
      (change.actual?.fields['name'] as string | undefined) ??
      resolveNameFromKey(change.actual?.key ?? change.key);
    const scopeNodeId = await resolveScopeNodeId(
      this.scope,
      change.actual?.fields['scope'] as string | null | undefined,
    );
    const bindingId = requireGitOpsBindingId(context.bindingId);
    await context.manager.query(
      `UPDATE skills SET is_active = false
       WHERE name = $1 AND scope_node_id IS NOT DISTINCT FROM $2 AND managed_by = $3${bindingId ? ' AND managed_binding_id = $4' : ' AND managed_binding_id IS NULL'}`,
      bindingId
        ? [name, scopeNodeId, GITOPS_MANAGED_BY, bindingId]
        : [name, scopeNodeId, GITOPS_MANAGED_BY],
    );
  }

  private async applyUpdate(
    desired: SkillDesiredInput,
    context: GitOpsApplyContext,
  ): Promise<void> {
    const resolved = await this.resolveDesired(desired);
    const bindingId = requireGitOpsBindingId(context.bindingId);
    const assignments = buildAssignments(resolved, bindingId);
    const params = [
      resolved.name,
      resolved.scopeNodeId,
      GITOPS_MANAGED_BY,
      ...assignments.map(([, value]) => value),
    ];
    const bindingClause =
      bindingId !== null
        ? ` AND managed_binding_id = $${assignments.length + 4}`
        : ' AND managed_binding_id IS NULL';
    if (bindingId !== null) params.push(bindingId);

    await context.manager.query(
      `UPDATE skills
       SET ${assignments.map(([column], index) => `${column} = $${index + 4}`).join(', ')}, is_active = true
       WHERE name = $1 AND scope_node_id IS NOT DISTINCT FROM $2 AND managed_by = $3${bindingClause}`,
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
    if (context.locked) return { allowed: false, reason: 'object is locked' };
    if (context.managedBy !== GITOPS_MANAGED_BY)
      return { allowed: false, reason: 'object is not gitops-managed' };
    return { allowed: true };
  }

  private toActual(
    row: SkillRow,
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
        description: row.description,
        skillMarkdown: row.skill_markdown,
        category: row.category,
        tags: fromDbArray(row.tags),
        metadata: row.metadata,
        version: row.version,
        source: row.source,
        locked: row.locked,
        overrides: row.overrides,
        baseRef: row.base_ref,
        managedBindingId: row.managed_binding_id,
        managedRevision: row.managed_revision,
        lastGitHash: row.last_git_hash,
        syncState: row.sync_state,
      },
      managedBy: row.managed_by,
      locked: row.locked,
    };
  }

  private async resolveDesired(input: SkillDesiredInput): Promise<{
    name: string;
    scopeNodeId: string | null;
    strategy: SkillStrategy;
    description: string;
    skillMarkdown: string;
    category: string | null;
    tags: string[] | null;
    metadata: Record<string, unknown> | null;
    version: number;
    source: SkillSource;
    locked: boolean;
    overrides: Record<string, unknown> | null;
    baseRef: string | null;
    managedBindingId: string | null;
    managedRevision: string | null;
    lastGitHash: string | null;
    syncState: string | null;
  }> {
    const identity = await this.resolveDesiredIdentity(input);
    return {
      ...identity,
      strategy: this.resolveDesiredStrategy(input.fields),
      ...this.resolveDesiredContent(input.fields),
      ...this.resolveDesiredManagement(input.fields),
    };
  }

  private async resolveDesiredIdentity(input: SkillDesiredInput): Promise<{
    name: string;
    scopeNodeId: string | null;
  }> {
    const { name: rawName, scope } = input.fields;
    return {
      name: rawName ?? resolveNameFromKey(input.key),
      scopeNodeId: await resolveScopeNodeId(this.scope, scope ?? null),
    };
  }

  private resolveDesiredContent(fields: SkillDesiredInput['fields']): {
    description: string;
    skillMarkdown: string;
    category: string | null;
    tags: string[] | null;
    metadata: Record<string, unknown> | null;
    version: number;
  } {
    const {
      description = '',
      skillMarkdown = '',
      category = null,
      tags = null,
      metadata = null,
      version = 1,
    } = fields;

    return { description, skillMarkdown, category, tags, metadata, version };
  }

  private resolveDesiredStrategy(
    fields: SkillDesiredInput['fields'],
  ): SkillStrategy {
    if (fields.strategy) {
      return fields.strategy;
    }

    return fields.overrides || fields.baseRef ? 'merge' : 'replace';
  }

  private resolveDesiredManagement(fields: SkillDesiredInput['fields']): {
    source: SkillSource;
    locked: boolean;
    overrides: Record<string, unknown> | null;
    baseRef: string | null;
    managedBindingId: string | null;
    managedRevision: string | null;
    lastGitHash: string | null;
    syncState: string | null;
  } {
    const {
      source: _source = 'repository',
      locked = false,
      overrides = null,
      baseRef = null,
      managedBindingId = null,
      managedRevision = null,
      lastGitHash = null,
      syncState = null,
    } = fields;

    return {
      source: 'repository',
      locked,
      overrides,
      baseRef,
      managedBindingId,
      managedRevision,
      lastGitHash,
      syncState,
    };
  }

  private resolveStrategy(row: SkillRow): SkillStrategy {
    return row.overrides || row.base_ref ? 'merge' : 'replace';
  }
}
