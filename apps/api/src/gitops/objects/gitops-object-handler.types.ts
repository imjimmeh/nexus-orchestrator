import type { EntityManager } from 'typeorm';
import type { GitOpsSyncableObjectType } from '@nexus/core';

export type GitOpsObjectOperation = 'create' | 'update' | 'delete' | 'noop';

export interface GitOpsNormalizedObject {
  objectType: GitOpsSyncableObjectType;
  key: string;
  fields: Record<string, unknown>;
}

export interface GitOpsSerializedObject extends GitOpsNormalizedObject {
  managedBy: string | null;
  locked: boolean;
}

export interface GitOpsPlanInput<
  TDesired = GitOpsNormalizedObject,
  TActual = GitOpsSerializedObject,
> {
  desired: TDesired | null;
  actual: TActual | null;
}

export interface GitOpsObjectPlan<
  TDesired = GitOpsNormalizedObject,
  TActual = GitOpsSerializedObject,
> {
  objectType: GitOpsSyncableObjectType;
  key: string;
  op: GitOpsObjectOperation;
  desired: TDesired | null;
  actual: TActual | null;
  diff?: Record<string, { from: unknown; to: unknown }>;
}

export interface GitOpsApplyContext {
  actorId: string;
  manager: EntityManager;
  bindingId?: string;
  conflictPolicy?: string;
}

export interface GitOpsEditPolicyContext {
  managedBy: string | null;
  locked: boolean;
  bindingId?: string;
  conflictPolicy?: string;
}

export interface GitOpsEditPolicyResult {
  allowed: boolean;
  reason?: string;
}

export interface GitOpsObjectHandler<
  TDesired = GitOpsNormalizedObject,
  TActual = GitOpsSerializedObject,
> {
  readonly objectType: GitOpsSyncableObjectType;
  readActual(scopeNodeId: string): Promise<TActual[]>;
  normalizeDesired(input: TDesired): GitOpsNormalizedObject;
  plan(
    change: GitOpsPlanInput<TDesired, TActual>,
  ): GitOpsObjectPlan<TDesired, TActual>;
  apply(
    change: GitOpsObjectPlan<TDesired, TActual>,
    context: GitOpsApplyContext,
  ): Promise<void>;
  serialize(actual: TActual): GitOpsSerializedObject;
  canEdit(context: GitOpsEditPolicyContext): GitOpsEditPolicyResult;
}
