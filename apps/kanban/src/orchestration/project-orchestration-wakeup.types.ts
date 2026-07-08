export interface RequestWakeupInput {
  projectId: string;
  reason: string;
  source?: string;
  dedupeKey?: string;
}

export type RequestWakeupResult =
  | { emitted: true }
  | {
      emitted: false;
      reason:
        | "active_cycle_exists"
        | "automatic_wakeup_coalesced"
        | "orchestration_auto_wake_suppressed"
        | "stale_wakeup_cooldown";
    };
