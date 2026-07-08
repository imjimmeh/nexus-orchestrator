import type { GitOpsBindingSyncMode } from '@nexus/core';

export interface ReconcileSummary {
  id: string;
  finishedAt: string;
  result: 'success' | 'failure';
  summary: { create: number; update: number; prune: number; drift: number };
  dryRun: boolean;
  auditEventId: string;
}

export interface GitOpsRunSummary {
  id: string;
  bindingId: string;
  direction: string;
  status: string;
  revision: string;
  summary: string | null;
  finishedAt: string | null;
}

export interface GitOpsBindingStatus {
  bindingId: string;
  name: string;
  scopeNodeId: string;
  syncMode: GitOpsBindingSyncMode;
  enabled: boolean;
  lastAppliedRevision: string | null;
  latestRun: GitOpsRunSummary | null;
  pendingChangeCount: number;
  driftCount: number;
}

export interface DriftSummary {
  kind: string;
  name: string;
  scopeNodeId: string;
  managedBy: string;
  driftedFields: string[];
  auditEventId: string;
}

export interface GitOpsStatusResponse {
  bindings: GitOpsBindingStatus[];
  lastReconcile: ReconcileSummary | null;
  drift: DriftSummary[];
  managedByCounts: Record<'gitops' | 'manual' | 'seed', number>;
}
