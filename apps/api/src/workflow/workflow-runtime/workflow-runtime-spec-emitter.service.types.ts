export interface SpecsReadyInput {
  scope_id: string;
  workflow_run_id: string;
  trigger?: 'spec_revision_complete' | 'spec_generation_complete';
}

export interface SpecsReadyResult {
  ok: boolean;
  event_id?: string;
}
