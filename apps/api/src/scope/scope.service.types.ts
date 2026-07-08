import type { ScopeNodeType } from './scope.constants.types';

export interface CreateScopeNodeInput {
  id?: string;
  parentId: string | null;
  type: ScopeNodeType;
  name: string;
  slug: string;
  metadata?: Record<string, unknown> | null;
  actorId?: string;
  /** Marks this node as a tenant/isolation boundary. Defaults to false. */
  isTenantRoot?: boolean;
}

/** Partial-update input for {@link ScopeService.updateNode}. */
export interface UpdateScopeNodeInput {
  name?: string;
  isTenantRoot?: boolean;
  actorId?: string;
}

/** A scope node with its descendants nested under `children`. */
export interface ScopeTreeNode {
  id: string;
  parentId: string | null;
  type: ScopeNodeType;
  name: string;
  slug: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  isTenantRoot: boolean;
  children: ScopeTreeNode[];
}
