import type { WorkflowRunRepository } from './database/repositories/workflow-run.repository';
import type { WorkflowRepository } from './database/repositories/workflow.repository';
import {
  resolveWorkflowIdForRun,
  resolveWorkflowNameById,
} from './workflow-run-id-resolver.helpers';

/**
 * Resolve the workflow DEFINITION NAME for a run (run → `workflow_id` →
 * `workflows.name`) with fail-soft semantics: absent run id, missing rows, or
 * a repository error all yield `undefined` (reported via `onError`) so callers
 * never throw. Composes {@link resolveWorkflowIdForRun} and
 * {@link resolveWorkflowNameById} from `workflow-run-id-resolver.helpers.ts`
 * rather than reimplementing the run→workflow_id→name lookup; shared by the
 * step prompt path (StepSupportService), the `remember` handler, and the
 * retrospective output router so workflow-name resolution lives in exactly
 * one place (Epic C).
 */
export async function resolveWorkflowNameForRun(
  runRepo: Pick<WorkflowRunRepository, 'findById'>,
  workflowRepo: Pick<WorkflowRepository, 'findById'>,
  workflowRunId: string | undefined,
  onError: (message: string) => void,
): Promise<string | undefined> {
  const workflowId = await resolveWorkflowIdForRun(
    runRepo,
    workflowRunId,
    onError,
  );
  return resolveWorkflowNameById(workflowRepo, workflowId, onError);
}
