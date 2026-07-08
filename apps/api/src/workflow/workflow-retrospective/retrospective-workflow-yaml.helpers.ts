/**
 * Collaborator-parameterized helper for resolving a run's CURRENT workflow
 * YAML + name. The YAML (Task 9) gives the analyst the full definition on
 * hand for a `workflow_definition_change` proposal (which must carry the
 * complete corrected YAML, never a fragment); the name (FU-16 Task A2) is
 * threaded into the analyst's launch trigger so the completion-side dedup
 * check can later widen its recall to the `workflow(<name>)` memory pool.
 * Extracted from `RetrospectiveAnalysisService.resolveOriginalWorkflowDetails`
 * — the fail-soft caller — purely to keep that orchestrator under the
 * project's per-file line budget; this function is pure composition, no I/O
 * of its own.
 */
import type { WorkflowRun } from '../database/entities/workflow-run.entity';
import type { Workflow } from '../database/entities/workflow.entity';
import type { OriginalWorkflowDetails } from './retrospective-analysis.types';

export async function resolveWorkflowDetailsForRun(
  workflowRunId: string,
  findRunById: (id: string) => Promise<WorkflowRun | null>,
  findWorkflowById: (id: string) => Promise<Workflow | null>,
): Promise<OriginalWorkflowDetails> {
  const run = await findRunById(workflowRunId);
  if (run === null) {
    return { yaml: undefined, name: undefined };
  }
  const workflow = await findWorkflowById(run.workflow_id);
  return {
    yaml: workflow?.yaml_definition ?? undefined,
    name: workflow?.name ?? undefined,
  };
}
