import type { KanbanRetrospectiveRunEntity } from "../database/entities/kanban-retrospective-run.entity";

/**
 * Converts a {@link KanbanRetrospectiveRunEntity} into the public API
 * response shape returned by the kanban retrospective endpoints.
 *
 * Extracted from {@link KanbanRetrospectiveService} to keep the main
 * service file under the project's `max-lines` budget. The mapping is
 * pure and stateless, so a plain function module keeps the test surface
 * narrow.
 */
export function toKanbanRetrospectiveRunResponse(
  row: KanbanRetrospectiveRunEntity,
): {
  id: string;
  idempotency_key: string;
  project_id: string;
  orchestration_id: string | null;
  trigger_type: string;
  trigger_revision_marker: string | null;
  replay_of_run_id: string | null;
  status: string;
  skipped_reason: string | null;
  failure_reason: string | null;
  candidate_count: number;
  diagnostics: Record<string, unknown> | null;
  delta_snapshot: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: row.id,
    idempotency_key: row.idempotency_key,
    project_id: row.project_id,
    orchestration_id: row.orchestration_id,
    trigger_type: row.trigger_type,
    trigger_revision_marker: row.trigger_revision_marker,
    replay_of_run_id: row.replay_of_run_id,
    status: row.status,
    skipped_reason: row.skip_reason,
    failure_reason: row.failure_reason,
    candidate_count: row.candidate_count,
    diagnostics: row.diagnostics_json,
    delta_snapshot: row.delta_snapshot_json,
    started_at: toIsoString(row.started_at),
    completed_at:
      row.completed_at === null ? null : toIsoString(row.completed_at),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

/**
 * Converts a {@link Date} to its ISO 8601 string representation. Extracted
 * to keep the response mapper in this file concise.
 */
export function toIsoString(value: Date): string {
  return value.toISOString();
}
