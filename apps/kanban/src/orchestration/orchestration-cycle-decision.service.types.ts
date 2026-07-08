import type { FailureClass } from "@nexus/core";

export const ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE =
  "ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE";

export type ClearPendingConsecutiveFailure = (
  projectId: string,
) => Promise<void>;

export type OrchestrationCycleDecisionInput = {
  decision?: "repeat" | "pause" | "complete" | "blocked";
  reason: string;
  idempotencyKey?: string;
  autonomousDefault?: boolean;
  readyWorkRemaining?: boolean;
  blockedItems?: Array<{ id: string; blockedReason: string }>;
  /**
   * When true, the previous workflow run ended in FAILED status and the
   * caller wants the cycle decision service to record the consecutive
   * failure and (when the configurable threshold is reached) trigger a
   * `failure_threshold` retrospective synchronously, before the next
   * orchestration cycle completes.
   *
   * Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35 (EPIC-117 / EPIC-202).
   */
  consecutiveFailure?: boolean;
  /** Failure classification discriminator (WI-2026-062). */
  failureClass?: FailureClass;
};

export type OrchestrationCycleDecisionResult = {
  decision: string;
  reason: string;
  persisted: boolean;
  duplicate: boolean;
  skipped?: boolean;
  /** Failure classification recorded for this cycle decision (WI-2026-062). */
  failureClass?: FailureClass;
};
