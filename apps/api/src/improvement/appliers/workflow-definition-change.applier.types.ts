/**
 * Pre-mutation snapshot of a workflow row's identity + YAML definition,
 * persisted into `rollback_data` before `WorkflowDefinitionChangeApplier.apply()`
 * mutates anything. `rollback()` restores the row from exactly these fields,
 * so the shape here must stay in sync with the columns `apply()` is allowed
 * to touch (`yaml_definition`, `overrides`).
 */
export interface WorkflowRollbackSnapshot {
  workflowId: string;
  name: string;
  yaml_definition: string;
  overrides: Record<string, unknown> | null;
}
