import type { EnforcementMode } from './enforcement-mode.types';

export interface DenialEvent {
  actorId: string;
  requiredPermission: string;
  scopeNodeId: string;
  scopePath?: string[] | null;
  enforcementMode: EnforcementMode;
}

export interface RoleChangeEvent {
  actorId: string;
  userId: string;
  roleId: string;
  scopeNodeId: string;
}

export interface ScopeCreatedEvent {
  actorId: string;
  scopeNodeId: string;
  parentId: string | null;
  type: string;
}

export interface ScopeMovedEvent {
  actorId: string;
  scopeNodeId: string;
  oldParentId: string | null;
  newParentId: string | null;
}

export interface ScopeDeletedEvent {
  actorId: string;
  scopeNodeId: string;
}

/** Compact before/after summary of a scope-node metadata update (rename, tenant-root toggle). */
export interface ScopeUpdatedEvent {
  actorId: string;
  scopeNodeId: string;
  changedFields: string[];
  previous: Record<string, unknown>;
  next: Record<string, unknown>;
}

export interface ScopeArchivedEvent {
  actorId: string;
  scopeNodeId: string;
}

export interface ScopeRestoredEvent {
  actorId: string;
  scopeNodeId: string;
}
