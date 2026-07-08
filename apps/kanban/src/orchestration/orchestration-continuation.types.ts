import type { FailureClass } from "@nexus/core";

export type ContinuationTrigger =
  | "workflow_completed"
  | "workflow_failed"
  | "work_item_completed"
  | "work_item_blocked"
  | "import_hydration_completed"
  | "manual_recovery_completed"
  | "poll_reconciliation";

export type ContinuationDecision = "repeat" | "pause" | "complete" | "blocked";

export type OrchestrationMode = "autonomous" | "supervised";

export interface EvaluateContinuationInput {
  projectId: string;
  trigger: ContinuationTrigger;
  workflowRunId?: string;
  workItemId?: string;
  reason?: string;
  mode?: OrchestrationMode;
  /**
   * When true, signals that the just-reconciled workflow run ended in
   * FAILED status. The cycle decision service will synchronously record
   * the consecutive failure and (at the threshold) fire a
   * `failure_threshold` retrospective. This is the work-item / EPIC-117 /
   * EPIC-202 signal that has to be passed all the way through to the
   * OrchestrationCycleDecisionService so the trigger fires BEFORE the
   * next orchestration cycle completes.
   *
   * Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35
   */
  consecutiveFailure?: boolean;
  /**
   * Optional discriminator classifying the failure when
   * `consecutiveFailure` is true. Only the classes that count toward
   * the threshold actually increment the consecutive-failure counter
   * (see `shouldCountFailure`). When omitted the failure is
   * conservatively treated as counting.
   *
   * Work item: 2a64258d-8542-4ca0-b582-42a69dd61ff0 (WI-2026-062).
   */
  failureClass?: FailureClass;
}

export interface EvaluateContinuationResult {
  decision: ContinuationDecision;
  emittedCycleRequest: boolean;
  persisted: boolean;
  reason: string;
  /**
   * Discriminator for the failure recorded (or not) during this
   * continuation evaluation, when applicable. Mirrors the
   * `failureClass` input so consumers can audit which classification
   * was applied.
   *
   * Work item: 2a64258d-8542-4ca0-b582-42a69dd61ff0 (WI-2026-062).
   */
  failureClass?: FailureClass;
}
