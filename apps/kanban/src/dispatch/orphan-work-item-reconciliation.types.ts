export interface OrphanReconciliationEntry {
  workItemId: string;
  previousStatus: string;
}

export interface OrphanReconciliationSummary {
  orphanReconciled: OrphanReconciliationEntry[];
}
