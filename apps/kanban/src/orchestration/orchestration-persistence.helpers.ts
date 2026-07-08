import type {
  ActionRequest,
  DecisionEntry,
  OrchestrationPersistenceRecord,
} from "./orchestration-internal.types";
import { isDecisionEntry } from "./orchestration-decision-log.utils";

/**
 * Merge update partials with existing persistence state to produce a save payload.
 * Extracted from OrchestrationService to reduce file size and method complexity.
 */
export function buildPersistenceSavePayload(
  existing: OrchestrationPersistenceRecord,
  updates: Partial<OrchestrationPersistenceRecord>,
  getDecisionLog: (state: OrchestrationPersistenceRecord) => DecisionEntry[],
  getActionRequests: (state: OrchestrationPersistenceRecord) => ActionRequest[],
) {
  return {
    project_id: existing.project_id,
    goals: updates.goals ?? existing.goals,
    mode: updates.mode ?? existing.mode,
    status: updates.status ?? existing.status,
    linked_run_id: resolveLinkedRunId(updates, existing),
    decision_log: updates.decision_log ?? getDecisionLog(existing),
    action_requests: updates.action_requests ?? getActionRequests(existing),
    metadata: updates.metadata ?? existing.metadata ?? null,
  };
}

/**
 * Reconstruct a full persistence record from a save result, falling back to the
 * previous state for any field the repository did not return.
 */
export function rebuildPersistenceRecord(
  saved: Partial<OrchestrationPersistenceRecord>,
  existing: OrchestrationPersistenceRecord,
  getDecisionLog: (state: OrchestrationPersistenceRecord) => DecisionEntry[],
  getActionRequests: (state: OrchestrationPersistenceRecord) => ActionRequest[],
): OrchestrationPersistenceRecord {
  return {
    project_id: saved.project_id ?? existing.project_id,
    goals: saved.goals ?? existing.goals,
    mode: saved.mode ?? existing.mode,
    status: saved.status ?? existing.status,
    linked_run_id: resolveLinkedRunId(saved, existing),
    decision_log: saved.decision_log ?? getDecisionLog(existing),
    action_requests: saved.action_requests ?? getActionRequests(existing),
    metadata: saved.metadata ?? existing.metadata ?? null,
    created_at: saved.created_at ?? existing.created_at,
    updated_at: saved.updated_at ?? existing.updated_at,
  };
}

export function filterDecisionLog(
  state: OrchestrationPersistenceRecord,
): DecisionEntry[] {
  return Array.isArray(state.decision_log)
    ? state.decision_log.filter(isDecisionEntry)
    : [];
}

export function filterActionRequests(
  state: OrchestrationPersistenceRecord,
): ActionRequest[] {
  return Array.isArray(state.action_requests) ? state.action_requests : [];
}

function resolveLinkedRunId(
  record: Partial<OrchestrationPersistenceRecord>,
  existing: OrchestrationPersistenceRecord,
): string | null {
  return "linked_run_id" in record
    ? (record.linked_run_id ?? null)
    : existing.linked_run_id;
}
