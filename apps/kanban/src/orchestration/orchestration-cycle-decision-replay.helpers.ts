import {
  getCycleDecision,
  isDecisionEntry,
  isCycleDecisionClearEntry,
  parseCycleDecision,
} from "./orchestration-decision-log.utils";
import type {
  CycleDecision,
  DecisionEntry,
  OrchestrationPersistenceRecord,
} from "./orchestration-internal.types";
import type {
  OrchestrationCycleDecisionInput,
  OrchestrationCycleDecisionResult,
} from "./orchestration-cycle-decision.service.types";

type CycleDecisionInput = OrchestrationCycleDecisionInput;
type CycleDecisionResult = OrchestrationCycleDecisionResult;

/**
 * Helpers that decide whether the cycle decision service should treat an
 * incoming request as a duplicate replay (idempotency-key match against
 * the persisted metadata or the historical decision log) or as an
 * autonomous default that the orchestrator should skip in favor of an
 * earlier explicit decision.
 *
 * Extracted from `orchestration-cycle-decision.service.ts` to keep that
 * service under the repository's `max-lines` lint rule.
 *
 * Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35 (EPIC-117 / EPIC-202).
 */

export function resolveDuplicateCycleReplay(args: {
  readonly metadata: Record<string, unknown>;
  readonly input: CycleDecisionInput;
  readonly existing: OrchestrationPersistenceRecord;
  readonly getDecisionLog: (
    state: OrchestrationPersistenceRecord,
  ) => DecisionEntry[];
}): CycleDecisionResult | null {
  const { metadata, input, existing, getDecisionLog } = args;

  if (!input.idempotencyKey) {
    return null;
  }

  const currentKeyMatch =
    metadata.cycle_decision_idempotency_key === input.idempotencyKey;
  const historicalKeyMatch = getDecisionLog(existing).find(
    (entry) =>
      isDecisionEntry(entry) &&
      entry.type === "cycle_decision" &&
      entry.idempotencyKey === input.idempotencyKey,
  );

  if (!currentKeyMatch && !historicalKeyMatch) {
    return null;
  }

  const historicalDecision = historicalKeyMatch
    ? getCycleDecision(historicalKeyMatch)
    : undefined;
  const metadataDecision = parseCycleDecision(metadata.cycle_decision);
  const historicalReason =
    typeof historicalKeyMatch?.reasoning === "string"
      ? historicalKeyMatch.reasoning
      : undefined;
  const metadataReason =
    typeof metadata.cycle_decision_reason === "string"
      ? metadata.cycle_decision_reason
      : undefined;

  return {
    decision: historicalDecision ?? metadataDecision ?? input.decision ?? "repeat",
    reason: historicalReason ?? metadataReason ?? input.reason,
    persisted: false,
    duplicate: true,
  };
}

export function shouldSkipAutonomousDefault(args: {
  readonly input: CycleDecisionInput;
  readonly existing: OrchestrationPersistenceRecord;
  readonly metadata: Record<string, unknown>;
  readonly getDecisionLog: (
    state: OrchestrationPersistenceRecord,
  ) => DecisionEntry[];
}): boolean {
  const { input, existing, metadata, getDecisionLog } = args;

  if (input.decision !== undefined) {
    return false;
  }

  if (!(input.autonomousDefault && input.readyWorkRemaining === true)) {
    return true;
  }

  if (existing.mode !== "autonomous") {
    return true;
  }

  const latestExplicitDecisionOrClear = getDecisionLog(existing)
    .slice()
    .reverse()
    .find((entry): entry is DecisionEntry => {
      if (!isDecisionEntry(entry)) {
        return false;
      }

      if (isCycleDecisionClearEntry(entry)) {
        return true;
      }

      if (entry.type !== "cycle_decision" || entry.autonomousDefault === true) {
        return false;
      }

      return parseCycleDecision(getCycleDecision(entry)) !== undefined;
    });

  const explicitDecision: CycleDecision | undefined = (() => {
    if (latestExplicitDecisionOrClear) {
      return getCycleDecision(latestExplicitDecisionOrClear);
    }
    if (metadata.cycle_decision_autonomous_default === true) {
      return undefined;
    }
    return parseCycleDecision(metadata.cycle_decision);
  })();

  return (
    explicitDecision === "pause" ||
    explicitDecision === "complete" ||
    explicitDecision === "blocked"
  );
}