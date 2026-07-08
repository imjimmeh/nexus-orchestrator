export const WORKFLOW_RUN_LOOKUP_SERVICE = 'WORKFLOW_RUN_LOOKUP_SERVICE';

export interface WorkflowRunLookupRecord {
  readonly id: string;
}

export interface IWorkflowRunLookupService {
  findByIds(ids: string[]): Promise<WorkflowRunLookupRecord[]>;
}
