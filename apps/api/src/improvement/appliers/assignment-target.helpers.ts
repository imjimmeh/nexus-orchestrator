import type {
  AgentProfileAssignmentTarget,
  AssignmentTarget,
  WorkflowStepAssignmentTarget,
} from '@nexus/core';
import type { AssignmentApplicationOutcome } from './skill-assignment.types';

/**
 * Coerces `payload.assignment_targets` (unknown JSON) into a typed, deduped
 * array of {@link AssignmentTarget}, silently dropping malformed entries.
 */
export function parseAssignmentTargets(raw: unknown): AssignmentTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: AssignmentTarget[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const target = coerceAssignmentTarget(entry);
    if (!target) continue;
    const key = JSON.stringify(target);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

/**
 * Splits a parsed {@link AssignmentTarget} array into its two concrete
 * target kinds for downstream appliers.
 */
export function partitionAssignmentTargets(targets: AssignmentTarget[]): {
  profileTargets: AgentProfileAssignmentTarget[];
  workflowTargets: WorkflowStepAssignmentTarget[];
} {
  const profileTargets: AgentProfileAssignmentTarget[] = [];
  const workflowTargets: WorkflowStepAssignmentTarget[] = [];
  for (const target of targets) {
    if (target.type === 'agent_profile') {
      profileTargets.push(target);
    } else {
      workflowTargets.push(target);
    }
  }
  return { profileTargets, workflowTargets };
}

/**
 * Merges applied/unrouted {@link AssignmentApplicationOutcome}s into a
 * proposal's existing `rollback_data`, without dropping unrelated keys.
 * Shared between the `skill_create` completion listener (applies targets
 * post-materialization) and {@link import('./skill-assignment.applier').SkillAssignmentApplier}
 * (applies targets synchronously for an already-existing skill) so both
 * paths record rollback state in the same shape.
 */
export function buildAssignmentRollbackData(
  existing: Record<string, unknown> | null,
  outcomes: AssignmentApplicationOutcome[],
): Record<string, unknown> {
  const appliedTargets: AssignmentTarget[] = [];
  const unroutedTargets: { target: AssignmentTarget; reason: string }[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === 'applied') {
      appliedTargets.push(outcome.target);
    } else {
      unroutedTargets.push({ target: outcome.target, reason: outcome.reason });
    }
  }
  return {
    ...(existing ?? {}),
    applied_targets: appliedTargets,
    unrouted_targets: unroutedTargets,
  };
}

function coerceAssignmentTarget(entry: unknown): AssignmentTarget | null {
  if (!entry || typeof entry !== 'object') return null;
  const candidate = entry as Record<string, unknown>;
  if (candidate.type === 'agent_profile') {
    return coerceAgentProfileTarget(candidate);
  }
  if (candidate.type === 'workflow_step') {
    return coerceWorkflowStepTarget(candidate);
  }
  return null;
}

function coerceAgentProfileTarget(
  candidate: Record<string, unknown>,
): AgentProfileAssignmentTarget | null {
  if (typeof candidate.profileName !== 'string' || !candidate.profileName) {
    return null;
  }
  return { type: 'agent_profile', profileName: candidate.profileName };
}

function coerceWorkflowStepTarget(
  candidate: Record<string, unknown>,
): WorkflowStepAssignmentTarget | null {
  if (typeof candidate.workflowName !== 'string' || !candidate.workflowName) {
    return null;
  }
  const target: WorkflowStepAssignmentTarget = {
    type: 'workflow_step',
    workflowName: candidate.workflowName,
  };
  if (typeof candidate.stepId === 'string' && candidate.stepId) {
    target.stepId = candidate.stepId;
  }
  return target;
}
