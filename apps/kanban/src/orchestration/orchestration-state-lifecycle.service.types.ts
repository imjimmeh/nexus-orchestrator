export type RecordImportHydrationBlockedInput = {
  blocked_stage: string;
  blocked_reason?: string;
  ready_for_cycle: boolean;
  hydration_summary?: Record<string, unknown>;
  child_run_id?: string;
  hydration_child_run_id?: string;
};
