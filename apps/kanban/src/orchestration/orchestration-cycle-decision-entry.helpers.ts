import type {
  CycleDecision,
  DecisionEntry,
} from "./orchestration-internal.types";
import type {
  OrchestrationCycleDecisionInput,
} from "./orchestration-cycle-decision.service.types";

type CycleDecisionInput = OrchestrationCycleDecisionInput;

/**
 * Helpers that build and persist the cycle-decision-shaped records:
 *
 * - {@link buildCycleDecisionEntry} materializes the new `DecisionEntry`
 *   appended to the persisted decision log on a non-duplicate, non-skipped
 *   cycle decision.
 * - {@link applyDecisionMetadata} writes the cycle-decision-shaped keys
 *   (`cycle_decision`, `cycle_decision_reason`,
 *   `cycle_decision_recorded_at`, `cycle_decision_idempotency_key`,
 *   `cycle_decision_autonomous_default`) onto the orchestration metadata
 *   in place so the orchestrator can read them on subsequent cycles.
 *
 * Extracted from `orchestration-cycle-decision.service.ts` to keep that
 * service under the repository's `max-lines` lint rule.
 *
 * Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35 (EPIC-117 / EPIC-202).
 */

export function buildCycleDecisionEntry(args: {
  readonly decision: CycleDecision;
  readonly reason: string;
  readonly recordedAt: string;
  readonly input: CycleDecisionInput;
  readonly wasAutonomousDefault: boolean;
}): DecisionEntry {
  const { decision, reason, recordedAt, input, wasAutonomousDefault } = args;

  return {
    timestamp: recordedAt,
    type: "cycle_decision",
    reasoning: reason,
    actions: [decision],
    cycleDecision: decision,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(wasAutonomousDefault
      ? {
          autonomousDefault: true,
          readyWorkRemaining: input.readyWorkRemaining === true,
        }
      : {}),
  };
}

export function applyDecisionMetadata(args: {
  readonly metadata: Record<string, unknown>;
  readonly safeDecision: { readonly decision: CycleDecision; readonly reason: string };
  readonly recordedAt: string;
  readonly input: CycleDecisionInput;
  readonly wasAutonomousDefault: boolean;
}): void {
  const { metadata, safeDecision, recordedAt, input, wasAutonomousDefault } =
    args;

  metadata.cycle_decision = safeDecision.decision;
  metadata.cycle_decision_reason = safeDecision.reason;
  metadata.cycle_decision_recorded_at = recordedAt;

  if (input.idempotencyKey) {
    metadata.cycle_decision_idempotency_key = input.idempotencyKey;
  } else {
    delete metadata.cycle_decision_idempotency_key;
  }

  if (wasAutonomousDefault) {
    metadata.cycle_decision_autonomous_default = true;
  } else {
    delete metadata.cycle_decision_autonomous_default;
  }
}