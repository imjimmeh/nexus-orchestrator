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
import { buildAgentProfileAssignments } from './agent-profile.gitops-handler.assignments';
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

type AgentProfileSource = 'seeded' | 'admin' | 'agent_factory' | 'repository';
type AgentProfileStrategy = 'merge' | 'replace';

interface AgentProfileRow {
  name: string;
  system_prompt: string | null;
  model_name: string | null;
  provider_name: string | null;
  provider_id: string | null;
  provider_source: 'global' | 'user' | 'scope' | null;
  tier_preference: string | null;
  supports_vision: boolean | null;
  allowed_mount_aliases: string | null;
  denied_mount_aliases: string | null;
  allow_rw_mount_aliases: string | null;
  assigned_skills: string | null;
  source: AgentProfileSource;
  tool_policy: Record<string, unknown> | null;
  scope_node_id: string | null;
  locked: boolean;
  overrides: Record<string, unknown> | null;
  base_ref: string | null;
  base_profile_id: string | null;
  managed_by: string | null;
  managed_binding_id: string | null;
  managed_revision: string | null;
  last_git_hash: string | null;
  sync_state: string | null;
}

interface AgentProfileDesiredInput {
  key: string;
  objectType: 'agent_profile';
  fields: {
    name?: string;
    scope?: string | null;
    strategy?: AgentProfileStrategy;
    systemPrompt?: string | null;
    modelName?: string | null;
    providerName?: string | null;
    providerId?: string | null;
    providerSource?: 'global' | 'user' | 'scope' | null;
    tierPreference?: string | null;
    supportsVision?: boolean | null;
    allowedMountAliases?: string[] | null;
    deniedMountAliases?: string[] | null;
    allowRwMountAliases?: string[] | null;
    assignedSkills?: string[] | null;
    toolPolicy?: Record<string, unknown> | null;
    source?: AgentProfileSource;
    locked?: boolean;
    overrides?: Record<string, unknown> | null;
    baseRef?: string | null;
    baseProfileId?: string | null;
    managedBindingId?: string | null;
    managedRevision?: string | null;
    lastGitHash?: string | null;
    syncState?: string | null;
  };
}
@Injectable()
export class AgentProfileGitopsHandler implements GitOpsObjectHandler<AgentProfileDesiredInput> {
  readonly objectType = 'agent_profile' as const;

  constructor(
    private readonly dataSource: DataSource,
    private readonly scope: ScopeService,
  ) {}

  async readActual(scopeNodeId: string): Promise<GitOpsSerializedObject[]> {
    const scopeIds = [
      scopeNodeId,
      ...(await this.scope.getDescendantIds(scopeNodeId)),
    ];
    const rows: AgentProfileRow[] = await this.dataSource.query(
      `SELECT name, system_prompt, model_name, provider_name, provider_id, provider_source, tier_preference, supports_vision, allowed_mount_aliases, denied_mount_aliases, allow_rw_mount_aliases, assigned_skills, source, tool_policy, scope_node_id, locked, overrides, base_ref, base_profile_id, managed_by, managed_binding_id, managed_revision, last_git_hash, sync_state
       FROM agent_profiles
       WHERE scope_node_id = ANY($1) AND is_active = true`,
      [scopeIds],
    );

    const scopePathById = await buildScopePathById(this.scope);
    return rows.map((row) => this.serialize(this.toActual(row, scopePathById)));
  }

  normalizeDesired(input: AgentProfileDesiredInput): GitOpsNormalizedObject {
    return {
      objectType: this.objectType,
      key: input.key,
      fields: { ...input.fields },
    };
  }

  plan(
    change: GitOpsPlanInput<AgentProfileDesiredInput>,
  ): GitOpsObjectPlan<AgentProfileDesiredInput> {
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
    change: GitOpsObjectPlan<AgentProfileDesiredInput>,
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
    desired: AgentProfileDesiredInput,
    context: GitOpsApplyContext,
  ): Promise<void> {
    const resolved = await this.resolveDesired(desired);
    const bindingId = requireGitOpsBindingId(context.bindingId);
    await context.manager.query(
      `INSERT INTO agent_profiles (
        name, system_prompt, model_name, provider_name, provider_id, provider_source,
        tier_preference, supports_vision, allowed_mount_aliases, denied_mount_aliases,
        allow_rw_mount_aliases, assigned_skills, source, locked, overrides, base_ref,
        base_profile_id, tool_policy, scope_node_id, managed_by, managed_binding_id,
        managed_revision, last_git_hash, sync_state, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, true)
      ON CONFLICT (name, scope_node_id) DO NOTHING`,
      [
        resolved.name,
        resolved.systemPrompt,
        resolved.modelName,
        resolved.providerName,
        resolved.providerId,
        resolved.providerSource,
        resolved.tierPreference,
        resolved.supportsVision,
        toDbArray(resolved.allowedMountAliases),
        toDbArray(resolved.deniedMountAliases),
        toDbArray(resolved.allowRwMountAliases),
        toDbArray(resolved.assignedSkills),
        'repository',
        resolved.locked,
        resolved.overrides,
        resolved.baseRef,
        resolved.baseProfileId,
        resolved.toolPolicy,
        resolved.scopeNodeId,
        GITOPS_MANAGED_BY,
        bindingId,
        resolved.managedRevision,
        resolved.lastGitHash,
        resolved.syncState,
      ],
    );
  }

  private async applyDelete(
    change: GitOpsObjectPlan<AgentProfileDesiredInput>,
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
      `UPDATE agent_profiles SET is_active = false
       WHERE name = $1 AND scope_node_id IS NOT DISTINCT FROM $2 AND managed_by = $3${bindingId ? ' AND managed_binding_id = $4' : ' AND managed_binding_id IS NULL'}`,
      bindingId
        ? [name, scopeNodeId, GITOPS_MANAGED_BY, bindingId]
        : [name, scopeNodeId, GITOPS_MANAGED_BY],
    );
  }

  private async applyUpdate(
    desired: AgentProfileDesiredInput,
    context: GitOpsApplyContext,
  ): Promise<void> {
    const resolved = await this.resolveDesired(desired);
    const bindingId = requireGitOpsBindingId(context.bindingId);
    const assignments = buildAgentProfileAssignments(resolved, bindingId);
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
      `UPDATE agent_profiles
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
    row: AgentProfileRow,
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
        systemPrompt: row.system_prompt,
        modelName: row.model_name,
        providerName: row.provider_name,
        providerId: row.provider_id,
        providerSource: row.provider_source,
        tierPreference: row.tier_preference,
        supportsVision: row.supports_vision,
        allowedMountAliases: fromDbArray(row.allowed_mount_aliases),
        deniedMountAliases: fromDbArray(row.denied_mount_aliases),
        allowRwMountAliases: fromDbArray(row.allow_rw_mount_aliases),
        assignedSkills: fromDbArray(row.assigned_skills),
        source: row.source,
        locked: row.locked,
        overrides: row.overrides,
        baseRef: row.base_ref,
        baseProfileId: row.base_profile_id,
        toolPolicy: row.tool_policy,
        managedBindingId: row.managed_binding_id,
        managedRevision: row.managed_revision,
        lastGitHash: row.last_git_hash,
        syncState: row.sync_state,
      },
      managedBy: row.managed_by,
      locked: row.locked,
    };
  }

  private async resolveDesired(input: AgentProfileDesiredInput): Promise<{
    name: string;
    scopeNodeId: string | null;
    strategy: AgentProfileStrategy;
    systemPrompt: string | null;
    modelName: string | null;
    providerName: string | null;
    providerId: string | null;
    providerSource: 'global' | 'user' | 'scope' | null;
    tierPreference: string | null;
    supportsVision: boolean | null;
    allowedMountAliases: string[] | null;
    deniedMountAliases: string[] | null;
    allowRwMountAliases: string[] | null;
    assignedSkills: string[] | null;
    source: AgentProfileSource;
    locked: boolean;
    overrides: Record<string, unknown> | null;
    baseRef: string | null;
    baseProfileId: string | null;
    toolPolicy: Record<string, unknown> | null;
    managedBindingId: string | null;
    managedRevision: string | null;
    lastGitHash: string | null;
    syncState: string | null;
  }> {
    const identity = await this.resolveDesiredIdentity(input);
    return {
      ...identity,
      strategy:
        input.fields.strategy ??
        (input.fields.overrides ||
        input.fields.baseRef ||
        input.fields.baseProfileId
          ? 'merge'
          : 'replace'),
      ...this.resolveDesiredContent(input.fields),
      ...this.resolveDesiredManagement(input.fields),
    };
  }

  private async resolveDesiredIdentity(
    input: AgentProfileDesiredInput,
  ): Promise<{
    name: string;
    scopeNodeId: string | null;
  }> {
    const { name: rawName, scope } = input.fields;
    return {
      name: rawName ?? resolveNameFromKey(input.key),
      scopeNodeId: await resolveScopeNodeId(this.scope, scope ?? null),
    };
  }

  private resolveDesiredContent(fields: AgentProfileDesiredInput['fields']): {
    systemPrompt: string | null;
    modelName: string | null;
    providerName: string | null;
    providerId: string | null;
    providerSource: 'global' | 'user' | 'scope' | null;
    tierPreference: string | null;
    supportsVision: boolean | null;
    allowedMountAliases: string[] | null;
    deniedMountAliases: string[] | null;
    allowRwMountAliases: string[] | null;
    assignedSkills: string[] | null;
    toolPolicy: Record<string, unknown> | null;
  } {
    const {
      systemPrompt = null,
      modelName = null,
      providerName = null,
      providerId = null,
      providerSource = null,
      tierPreference = null,
      supportsVision = null,
      allowedMountAliases = null,
      deniedMountAliases = null,
      allowRwMountAliases = null,
      assignedSkills = null,
      toolPolicy = null,
    } = fields;
    return {
      systemPrompt,
      modelName,
      providerName,
      providerId,
      providerSource,
      tierPreference,
      supportsVision,
      allowedMountAliases,
      deniedMountAliases,
      allowRwMountAliases,
      assignedSkills,
      toolPolicy,
    };
  }
  private resolveDesiredManagement(
    fields: AgentProfileDesiredInput['fields'],
  ): {
    source: AgentProfileSource;
    locked: boolean;
    overrides: Record<string, unknown> | null;
    baseRef: string | null;
    baseProfileId: string | null;
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
      baseProfileId = null,
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
      baseProfileId,
      managedBindingId,
      managedRevision,
      lastGitHash,
      syncState,
    };
  }
  private resolveStrategy(row: AgentProfileRow): AgentProfileStrategy {
    const isMerge = row.overrides || row.base_ref || row.base_profile_id;
    return isMerge ? 'merge' : 'replace';
  }
}
