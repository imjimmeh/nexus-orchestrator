export const doctorRepairHistoryStatuses = [
  'running',
  'succeeded',
  'partial',
  'failed',
] as const;

export type DoctorRepairHistoryStatus =
  (typeof doctorRepairHistoryStatuses)[number];
