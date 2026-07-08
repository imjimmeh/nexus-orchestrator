import type {
  DoctorRepairExecutionResult,
  DoctorRepairHistoryItem,
} from './doctor.types';
import type { RepairOutcome } from './doctor-repair-executor.types';

export function mapDoctorRepairExecutionResult(params: {
  history: DoctorRepairHistoryItem;
  outcome: RepairOutcome;
}): DoctorRepairExecutionResult {
  return {
    attempt_id: params.history.id,
    action_id: params.history
      .action_id as DoctorRepairExecutionResult['action_id'],
    status: params.outcome.status,
    dry_run: params.history.dry_run,
    started_at: params.history.started_at,
    finished_at: params.history.finished_at ?? new Date().toISOString(),
    message: params.outcome.message,
    changes: params.outcome.changes,
    evidence: params.outcome.evidence,
  };
}

export function mapDoctorRepairHistoryItem(record: {
  id: string;
  action_id: string;
  status: string;
  dry_run: boolean;
  requested_by?: string | null;
  input_json?: Record<string, unknown> | null;
  result_json?: Record<string, unknown> | null;
  evidence_json?: Record<string, unknown> | null;
  error_message?: string | null;
  started_at: Date;
  finished_at?: Date | null;
  created_at: Date;
}): DoctorRepairHistoryItem {
  return {
    id: record.id,
    action_id: record.action_id,
    status: record.status as DoctorRepairHistoryItem['status'],
    dry_run: record.dry_run,
    requested_by: record.requested_by ?? null,
    input_json: record.input_json ?? null,
    result_json: record.result_json ?? null,
    evidence_json: record.evidence_json ?? null,
    error_message: record.error_message ?? null,
    started_at: record.started_at.toISOString(),
    finished_at: record.finished_at ? record.finished_at.toISOString() : null,
    created_at: record.created_at.toISOString(),
  };
}
