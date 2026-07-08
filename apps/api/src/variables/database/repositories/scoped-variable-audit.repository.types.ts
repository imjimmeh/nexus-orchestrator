export interface RecordAuditInput {
  scopeNodeId: string | null;
  key: string;
  action: 'upsert' | 'delete';
  previousValue: unknown;
  newValue: unknown;
  actor?: string | null;
}
