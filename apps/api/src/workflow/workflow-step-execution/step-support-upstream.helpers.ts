import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import type { StateManagerService } from '../state-manager.service';
import {
  asRecord,
  formatContextSections,
  resolveOutputText,
  truncateContextText,
} from './step-support-context.helpers';

const MAX_CONTEXT_CHARS_PER_STEP = 2000;

const ENABLE_IMPLICIT_UPSTREAM_CONTEXT =
  process.env.WORKFLOW_ENABLE_IMPLICIT_UPSTREAM_CONTEXT === 'true';

export async function resolveUpstreamIds(
  workflowRunId: string,
  explicitIds: Set<string>,
  scopeKey: 'steps' | 'jobs',
  currentId: string,
  runRepo: IWorkflowRunRepository,
): Promise<Set<string>> {
  if (explicitIds.size > 0 || !ENABLE_IMPLICIT_UPSTREAM_CONTEXT) {
    return explicitIds;
  }
  const run = await runRepo.findById(workflowRunId);
  const runState = asRecord(run?.state_variables);
  const scopedState = asRecord(runState?.[scopeKey]);
  if (!scopedState) {
    return explicitIds;
  }
  for (const [candidateId, candidateState] of Object.entries(scopedState)) {
    if (candidateId === currentId) {
      continue;
    }

    if (asRecord(candidateState)?.output !== undefined) {
      explicitIds.add(candidateId);
    }
  }
  return explicitIds;
}

export async function buildUpstreamSections(
  workflowRunId: string,
  upstreamIds: Set<string>,
  scopePrefix: 'steps' | 'jobs',
  label: 'Step' | 'Job',
  stateManager: StateManagerService,
): Promise<string[]> {
  const sections: string[] = [];

  for (const depId of upstreamIds) {
    const output = (await stateManager.getVariable(
      workflowRunId,
      `${scopePrefix}.${depId}.output`,
    )) as Record<string, unknown> | null | undefined;

    if (!output) {
      continue;
    }

    const text = truncateContextText(
      resolveOutputText(output),
      MAX_CONTEXT_CHARS_PER_STEP,
    );
    sections.push(`### ${label}: ${depId}\n${text}`);
  }
  return sections;
}

export async function buildUpstreamContextForStep(
  workflowRunId: string,
  dependsOn: string[],
  stepId: string,
  runRepo: IWorkflowRunRepository,
  stateManager: StateManagerService,
): Promise<string> {
  const upstreamIds = await resolveUpstreamIds(
    workflowRunId,
    new Set(dependsOn),
    'steps',
    stepId,
    runRepo,
  );
  const sections = await buildUpstreamSections(
    workflowRunId,
    upstreamIds,
    'steps',
    'Step',
    stateManager,
  );
  return formatContextSections('steps', sections);
}

export async function buildUpstreamContextForJob(
  workflowRunId: string,
  dependsOn: string[],
  jobId: string,
  runRepo: IWorkflowRunRepository,
  stateManager: StateManagerService,
): Promise<string> {
  const upstreamIds = await resolveUpstreamIds(
    workflowRunId,
    new Set(dependsOn),
    'jobs',
    jobId,
    runRepo,
  );
  const sections = await buildUpstreamSections(
    workflowRunId,
    upstreamIds,
    'jobs',
    'Job',
    stateManager,
  );
  return formatContextSections('jobs', sections);
}
