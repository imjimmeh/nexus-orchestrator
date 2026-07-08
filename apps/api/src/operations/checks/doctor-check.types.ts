import type { DoctorCheckResult } from '../doctor.types';

export interface DoctorCheck {
  readonly checkId: string;
  run(): Promise<DoctorCheckResult>;
}
