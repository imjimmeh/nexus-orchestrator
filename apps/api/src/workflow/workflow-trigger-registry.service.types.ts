export interface WorkflowTriggerBinding {
  workflowId: string;
  workflowName: string;
  workflowDefinitionId: string;
  triggerName: string;
  /**
   * Raw Handlebars condition template from the workflow YAML trigger block.
   * Evaluated at trigger time via `evaluateTriggerCondition`.
   */
  condition?: string;
  triggerType: 'event' | 'webhook' | 'lifecycle';
  phase?: string;
  hook?: string;
  blocking?: boolean;
  bindingSource: 'workflow_row';
}

export interface WorkflowTriggerDiagnostics {
  bindings: WorkflowTriggerBinding[];
  skipped: ReadonlyArray<{
    workflowId: string;
    reason: 'parse_error' | 'missing_trigger_name' | 'duplicate_binding';
    error: string;
  }>;
  summary: {
    activeWorkflowCount: number;
    bindingCount: number;
    skippedCount: number;
    duplicateSuppressionCount: number;
  };
}
