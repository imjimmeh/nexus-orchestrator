import type { NonAutoWakeCycleDecision } from "./orchestration-stop-decisions.types";

type CycleDecision = NonAutoWakeCycleDecision | "repeat";

const NON_AUTO_WAKE_DECISIONS: ReadonlySet<NonAutoWakeCycleDecision> = new Set([
  "pause",
  "complete",
  "blocked",
]);
const CYCLE_DECISIONS: ReadonlySet<CycleDecision> = new Set([
  "repeat",
  "pause",
  "complete",
  "blocked",
]);
const STOPPED_LIFECYCLE_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "paused",
]);

export function isStoppedLifecycleStatus(status: string): boolean {
  return STOPPED_LIFECYCLE_STATUSES.has(status);
}

export function resolveNonAutoWakeDecision(state: {
  decision_log?: unknown;
  metadata?: unknown;
}): NonAutoWakeCycleDecision | undefined {
  const metadataDecision = readDecisionFromMetadata(state.metadata);
  if (metadataDecision) return metadataDecision;

  return readDecisionFromLatestLogEntry(state.decision_log);
}

function readDecisionFromMetadata(
  metadata: unknown,
): NonAutoWakeCycleDecision | undefined {
  if (metadata === null || typeof metadata !== "object") return undefined;
  if (!("cycle_decision" in metadata)) return undefined;

  return toNonAutoWakeDecision(metadata.cycle_decision);
}

function readDecisionFromLatestLogEntry(
  decisionLog: unknown,
): NonAutoWakeCycleDecision | undefined {
  if (!Array.isArray(decisionLog) || decisionLog.length === 0) return undefined;

  for (let index = decisionLog.length - 1; index >= 0; index -= 1) {
    const decisionEntry = readCycleDecisionEntry(decisionLog[index]);
    if (decisionEntry.relevant) return decisionEntry.decision;
  }

  return undefined;
}

function readCycleDecisionEntry(value: unknown): {
  relevant: boolean;
  decision?: NonAutoWakeCycleDecision;
} {
  if (value === null || typeof value !== "object") {
    return { relevant: false };
  }

  if (isCycleDecisionClear(value)) {
    return { relevant: true };
  }

  if ("cycleDecision" in value) {
    const decision = toCycleDecision(value.cycleDecision);
    if (decision) return toResolvedDecision(decision);
  }

  if ("decision" in value) {
    const decision = toCycleDecision(value.decision);
    if (decision) return toResolvedDecision(decision);
  }

  if ("actions" in value && Array.isArray(value.actions)) {
    const decision = toCycleDecision(value.actions[0]);
    if (decision) return toResolvedDecision(decision);
  }

  return { relevant: false };
}

function isCycleDecisionClear(value: object): boolean {
  return (
    ("type" in value && value.type === "cycle_decision_cleared") ||
    ("actions" in value &&
      Array.isArray(value.actions) &&
      value.actions[0] === "clear_cycle_decision")
  );
}

function toResolvedDecision(decision: CycleDecision): {
  relevant: true;
  decision?: NonAutoWakeCycleDecision;
} {
  return decision === "repeat"
    ? { relevant: true }
    : { relevant: true, decision };
}

function toCycleDecision(value: unknown): CycleDecision | undefined {
  if (typeof value !== "string") return undefined;
  return CYCLE_DECISIONS.has(value as CycleDecision)
    ? (value as CycleDecision)
    : undefined;
}

function toNonAutoWakeDecision(
  value: unknown,
): NonAutoWakeCycleDecision | undefined {
  if (typeof value !== "string") return undefined;
  return NON_AUTO_WAKE_DECISIONS.has(value as NonAutoWakeCycleDecision)
    ? (value as NonAutoWakeCycleDecision)
    : undefined;
}
