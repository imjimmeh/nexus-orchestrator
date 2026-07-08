export interface RecordInvestigationFindingParams {
  scope_id: string;
  summary: string;
  evidence_refs?: string[];
  workflow_run_id?: string;
  tags?: string[];
}
