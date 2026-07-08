export interface AddBindingInput {
  workflowName: string;
  stepId: string | null;
  skillName: string;
  provenance?: Record<string, unknown>;
}

export interface RemoveBindingInput {
  workflowName: string;
  stepId: string | null;
  skillName: string;
}
