import { isRecord, type IWorkflowRun } from '@nexus/core';
import type { WorkflowRunDisplayItem } from './workflow-run-display.types';

export type { WorkflowRunDisplayItem };

export function getTriggerDisplayName(run: IWorkflowRun): string | null {
  const trigger = run.state_variables.trigger;
  if (!isRecord(trigger)) {
    return null;
  }

  const candidate = trigger.displayName ?? trigger.display_name;
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate.trim()
    : null;
}

export function resolveWorkflowRunDisplayName(
  run: IWorkflowRun,
  workflowName: string | null,
): string {
  return (
    getTriggerDisplayName(run) ??
    workflowName ??
    `Workflow run ${run.id.slice(0, 8)}`
  );
}

export function enrichWorkflowRunDisplayNames(
  runs: IWorkflowRun[],
  resolveName: (run: IWorkflowRun) => WorkflowRunDisplayItem,
): WorkflowRunDisplayItem[] {
  return runs.map(resolveName);
}
