import type { ReconcileObjectType } from './gitops.constants.types';

export type ReconcileOp = 'create' | 'update' | 'delete' | 'noop';

export interface DesiredObject {
  type: ReconcileObjectType;
  key: string;
  fields: Record<string, unknown>;
}

export interface ActualObject extends DesiredObject {
  managedBy: string | null;
  locked: boolean;
  hasForeignDescendants?: boolean;
}

export interface ReconcileChange {
  type: ReconcileObjectType;
  key: string;
  op: ReconcileOp;
  diff?: Record<string, { from: unknown; to: unknown }>;
  skippedReason?: string;
  conflict?: boolean;
}

export interface ReconciliationPlan {
  changes: ReconcileChange[];
  summary: Record<ReconcileOp, number>;
}

export interface DesiredState {
  prune: boolean;
  objects: DesiredObject[];
}

export interface ActualState {
  objects: ActualObject[];
}

export type DriftCategory = 'db_only' | 'git_only' | 'field_divergence';

export interface DriftReport {
  drifted: Array<{
    type: ReconcileObjectType;
    key: string;
    category: DriftCategory;
    diff?: Record<string, { from: unknown; to: unknown }>;
  }>;
  inSync: number;
}
