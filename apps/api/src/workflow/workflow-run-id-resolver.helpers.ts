import type { IWorkflowRunRepository } from './kernel/interfaces/workflow-kernel.ports';
import type { WorkflowRepository } from './database/repositories/workflow.repository';
import { WorkflowParserService } from './workflow-parser.service';
import { extractYamlSkillNames } from './workflow-yaml-skills.helpers';

/**
 * Resolves the workflow definition id for a given run with fail-soft semantics:
 * returns `undefined` when the run is not found or the lookup fails so callers
 * always receive a (possibly absent) value rather than throwing.
 *
 * Shared by the step execution path (StepSupportService) and the subagent spawn
 * path (spawnExecutionContainer) so the run→workflowId pattern lives in exactly
 * one place.
 */
export async function resolveWorkflowIdForRun(
  runRepo: Pick<IWorkflowRunRepository, 'findById'>,
  workflowRunId: string | undefined,
  onError: (message: string) => void,
): Promise<string | undefined> {
  if (!workflowRunId) {
    return undefined;
  }
  try {
    const run = await runRepo.findById(workflowRunId);
    return run?.workflow_id;
  } catch (error) {
    onError(`Failed to resolve workflowId for run ${workflowRunId}: ${error}`);
    return undefined;
  }
}

/**
 * Resolves the workflow definition *name* (as opposed to its id) for a given
 * workflow id, with the same fail-soft semantics as {@link resolveWorkflowIdForRun}:
 * returns `undefined` when the id is absent, the workflow is not found, or the
 * lookup fails, so callers always receive a (possibly absent) value rather
 * than throwing.
 *
 * Shared by the step execution path (`StepSupportService`) and the subagent
 * spawn path so both resolve a workflow's name the same way — this is the
 * value `workflow_skill_bindings` rows are keyed by.
 */
export async function resolveWorkflowNameById(
  workflowRepo: Pick<WorkflowRepository, 'findById'>,
  workflowId: string | undefined,
  onError: (message: string) => void,
): Promise<string | undefined> {
  if (!workflowId) {
    return undefined;
  }
  try {
    const workflow = await workflowRepo.findById(workflowId);
    return workflow?.name;
  } catch (error) {
    onError(
      `Failed to resolve workflow name for workflow ${workflowId}: ${error}`,
    );
    return undefined;
  }
}

/**
 * Resolves a workflow's YAML-declared workflow-level skill names
 * (`IWorkflowDefinition.skills`, Epic B Task 5) for a given workflow id, with
 * the same fail-soft semantics as {@link resolveWorkflowNameById}: returns an
 * empty array when the id is absent, the workflow is not found, or parsing
 * fails, rather than throwing.
 *
 * `WorkflowParserService` has no constructor dependencies, so it's
 * instantiated directly here rather than threaded through DI — this keeps
 * the subagent-provisioning context free of an extra module wiring
 * dependency for what is a single, cheap, side-effect-free parse.
 */
export async function resolveWorkflowYamlSkillsById(
  workflowRepo: Pick<WorkflowRepository, 'findById'>,
  workflowId: string | undefined,
  onError: (message: string) => void,
): Promise<string[]> {
  if (!workflowId) {
    return [];
  }
  try {
    const workflow = await workflowRepo.findById(workflowId);
    if (!workflow?.yaml_definition) {
      return [];
    }
    const parsed = new WorkflowParserService().parseWorkflow(
      workflow.yaml_definition,
    );
    return parsed.skills ?? [];
  } catch (error) {
    onError(
      `Failed to resolve workflow YAML skills for workflow ${workflowId}: ${error}`,
    );
    return [];
  }
}

/**
 * Resolves a single job's YAML-declared step-level skill names
 * (`inputs.skills`, Epic B Task 5) for a given workflow id + step (job) YAML
 * id, with the same fail-soft semantics as {@link resolveWorkflowYamlSkillsById}:
 * returns an empty array when either id is absent, the workflow or matching
 * job is not found, or parsing fails, rather than throwing.
 *
 * This is the subagent-path counterpart of the step executor's
 * `extractYamlSkillNames(resolvedJobInputs)` call — the step executor already
 * has the job's resolved `inputs` in memory, but the subagent-provisioning
 * path only has a workflow id + the spawning step's YAML id, so it must
 * re-parse the workflow definition to find the matching job.
 */
export async function resolveStepYamlSkillsById(
  workflowRepo: Pick<WorkflowRepository, 'findById'>,
  workflowId: string | undefined,
  stepId: string | undefined,
  onError: (message: string) => void,
): Promise<string[]> {
  if (!workflowId || !stepId) {
    return [];
  }
  try {
    const workflow = await workflowRepo.findById(workflowId);
    if (!workflow?.yaml_definition) {
      return [];
    }
    const parsed = new WorkflowParserService().parseWorkflow(
      workflow.yaml_definition,
    );
    const job = parsed.jobs?.find((candidate) => candidate.id === stepId);
    return extractYamlSkillNames(job?.inputs);
  } catch (error) {
    onError(
      `Failed to resolve step YAML skills for workflow ${workflowId} step ${stepId}: ${error}`,
    );
    return [];
  }
}
