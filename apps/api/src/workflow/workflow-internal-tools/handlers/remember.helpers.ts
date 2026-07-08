import type { InternalToolExecutionContext, RememberBody } from '@nexus/core';
import type { WorkflowRunRepository } from '../../database/repositories/workflow-run.repository';
import type { WorkflowRepository } from '../../database/repositories/workflow.repository';
import { resolveWorkflowNameForRun } from '../../workflow-run-name-resolver.helpers';
import type { RememberScopeResolution } from './remember.types';

export type { RememberScopeResolution } from './remember.types';

/**
 * Resolve the entity id for a `remember` scope from run context — agents
 * never supply raw ids (Epic C). `agent` → the calling profile's name;
 * `workflow` → the run's workflow definition name; `project` → the neutral
 * scopeId; `global` → null. Returns `{ ok: false }` when the scope cannot be
 * resolved so the caller refuses the write loudly instead of silently
 * falling back to a global memory.
 */
export async function resolveRememberScope(
  runRepo: Pick<WorkflowRunRepository, 'findById'>,
  workflowRepo: Pick<WorkflowRepository, 'findById'>,
  context: InternalToolExecutionContext,
  scope: RememberBody['scope'],
  onWarn: (message: string) => void,
): Promise<RememberScopeResolution> {
  if (scope === 'global') {
    return { ok: true, scopeId: null };
  }
  if (scope === 'agent') {
    const profileName = context.agentProfileName?.trim();
    return profileName ? { ok: true, scopeId: profileName } : { ok: false };
  }
  if (scope === 'workflow') {
    const workflowName = await resolveWorkflowNameForRun(
      runRepo,
      workflowRepo,
      context.workflowRunId,
      onWarn,
    );
    return workflowName ? { ok: true, scopeId: workflowName } : { ok: false };
  }
  return { ok: true, scopeId: context.scopeId ?? null };
}
