import type { GitOpsPendingChange } from './database/entities/gitops-pending-change.entity';

export interface ReconciliationDiffOptions {
  pendingChanges?: GitOpsPendingChange[];
  lastAppliedRevision?: string | null;
}
