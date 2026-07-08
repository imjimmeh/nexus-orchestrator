export interface CreateSyncOperationLogInput {
  connection_id: string;
  project_id: string;
  work_item_id?: string | null;
  external_id?: string | null;
  direction: string;
  operation: string;
  status: string;
  message?: string | null;
  details?: Record<string, unknown>;
}
