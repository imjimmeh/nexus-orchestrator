import type {
  CycleDecision,
  DecisionEntry,
  PublicDecisionEntry,
  StopCycleDecision,
} from "./orchestration-internal.types";

const CYCLE_DECISIONS: readonly CycleDecision[] = [
  "repeat",
  "pause",
  "complete",
  "blocked",
];

const NON_AUTO_WAKE_DECISIONS: ReadonlySet<StopCycleDecision> = new Set(
  CYCLE_DECISIONS.filter(
    (decision): decision is StopCycleDecision => decision !== "repeat",
  ),
);

const REQUESTED_ACTIONS = [
  "dispatch_start_work_items",
  "invoke_agent_workflow",
  "update_project_strategy",
  "create_agent_profile",
  "complete_orchestration",
] as const;

const MODE_EVALUATIONS = ["allow", "deny", "require_approval"] as const;

const EXECUTION_STATUSES = [
  "executed",
  "queued_for_approval",
  "denied",
  "failed",
] as const;

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

export function isDecisionEntry(value: unknown): value is DecisionEntry {
  return value !== null && typeof value === "object";
}

export function parseCycleDecision(value: unknown): CycleDecision | undefined {
  return isOneOf(value, CYCLE_DECISIONS) ? value : undefined;
}

export function getCycleDecision(
  entry: DecisionEntry,
): CycleDecision | undefined {
  if (isOneOf(entry.cycleDecision, CYCLE_DECISIONS)) {
    return entry.cycleDecision;
  }

  const firstAction = Array.isArray(entry.actions)
    ? entry.actions[0]
    : undefined;
  return isOneOf(firstAction, CYCLE_DECISIONS) ? firstAction : undefined;
}

export function isCycleDecisionClearEntry(entry: DecisionEntry): boolean {
  return (
    entry.type === "cycle_decision_cleared" ||
    (Array.isArray(entry.actions) &&
      entry.actions[0] === "clear_cycle_decision")
  );
}

export function isNonAutoWakeDecision(
  value: unknown,
): value is StopCycleDecision {
  return (
    typeof value === "string" &&
    NON_AUTO_WAKE_DECISIONS.has(value as StopCycleDecision)
  );
}

function assignRequestedAction(
  target: PublicDecisionEntry,
  value: unknown,
): void {
  if (isOneOf(value, REQUESTED_ACTIONS)) {
    target.requestedAction = value;
  }
}

function assignModeEvaluation(
  target: PublicDecisionEntry,
  value: unknown,
): void {
  if (isOneOf(value, MODE_EVALUATIONS)) {
    target.modeEvaluation = value;
  }
}

function assignExecutionStatus(
  target: PublicDecisionEntry,
  value: unknown,
): void {
  if (isOneOf(value, EXECUTION_STATUSES)) {
    target.executionStatus = value;
  }
}

function assignStringField(
  target: PublicDecisionEntry,
  key: "correlationId" | "recommendation" | "idempotencyKey",
  value: unknown,
): void {
  if (typeof value === "string") {
    target[key] = value;
  }
}

function assignBooleanField(
  target: PublicDecisionEntry,
  key: "autonomousDefault" | "readyWorkRemaining",
  value: unknown,
): void {
  if (typeof value === "boolean") {
    target[key] = value;
  }
}

export function toPublicDecisionEntry(
  entry: DecisionEntry,
): PublicDecisionEntry | null {
  if (
    typeof entry.timestamp !== "string" ||
    typeof entry.type !== "string" ||
    typeof entry.reasoning !== "string" ||
    !Array.isArray(entry.actions) ||
    !entry.actions.every((action) => typeof action === "string")
  ) {
    return null;
  }

  const publicEntry: PublicDecisionEntry = {
    timestamp: entry.timestamp,
    type: entry.type,
    reasoning: entry.reasoning,
    actions: entry.actions,
  };
  const cycleDecision = getCycleDecision(entry);

  assignRequestedAction(publicEntry, entry.requestedAction);
  assignModeEvaluation(publicEntry, entry.modeEvaluation);
  assignExecutionStatus(publicEntry, entry.executionStatus);
  assignStringField(publicEntry, "correlationId", entry.correlationId);
  assignStringField(publicEntry, "recommendation", entry.recommendation);
  if (cycleDecision) {
    publicEntry.cycleDecision = cycleDecision;
  }
  assignStringField(publicEntry, "idempotencyKey", entry.idempotencyKey);
  assignBooleanField(publicEntry, "autonomousDefault", entry.autonomousDefault);
  assignBooleanField(
    publicEntry,
    "readyWorkRemaining",
    entry.readyWorkRemaining,
  );

  return publicEntry;
}
