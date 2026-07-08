import type { DoctorRepairOutcomeStatus } from './doctor.types';

export interface RepairOutcome {
  status: DoctorRepairOutcomeStatus;
  message: string;
  changes: Record<string, unknown>;
  evidence: Record<string, unknown>;
}
