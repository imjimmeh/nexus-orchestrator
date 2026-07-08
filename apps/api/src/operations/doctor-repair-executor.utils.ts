import type { DoctorRepairOutcomeStatus } from './doctor.types';
import type { RepairOutcome } from './doctor-repair-executor.types';

export function readIntegerRepairArgument(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.floor(value);
  if (rounded < min || rounded > max) {
    return fallback;
  }

  return rounded;
}

export function buildWorkflowRequeueOutcome(params: {
  candidateRunIds: string[];
  resumedRunIds: string[];
  skippedRunIds: string[];
  stalePendingMinutes: number;
  maxRuns: number;
}): RepairOutcome {
  const {
    candidateRunIds,
    resumedRunIds,
    skippedRunIds,
    stalePendingMinutes,
    maxRuns,
  } = params;

  let status: DoctorRepairOutcomeStatus = 'failed';
  if (skippedRunIds.length === 0) {
    status = 'succeeded';
  } else if (resumedRunIds.length > 0) {
    status = 'partial';
  }

  return {
    status,
    message:
      status === 'succeeded'
        ? `Requeued ${resumedRunIds.length.toString()} workflow run(s).`
        : `Requeue completed with ${resumedRunIds.length.toString()} resumed and ${skippedRunIds.length.toString()} skipped run(s).`,
    changes: {
      candidate_runs: candidateRunIds.length,
      resumed_runs: resumedRunIds.length,
      skipped_runs: skippedRunIds.length,
    },
    evidence: {
      resumed_run_ids: resumedRunIds,
      skipped_run_ids: skippedRunIds,
      stale_pending_minutes: stalePendingMinutes,
      max_runs: maxRuns,
    },
  };
}
