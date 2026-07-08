export interface WorkflowSkillBindingKey {
  workflowName: string;
  stepId: string | null;
  skillName: string;
}

export interface InsertWorkflowSkillBindingInput {
  workflow_name: string;
  step_id: string | null;
  skill_name: string;
  provenance: Record<string, unknown> | null;
}
