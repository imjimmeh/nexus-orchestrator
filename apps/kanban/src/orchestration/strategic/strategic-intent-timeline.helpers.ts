import type { DecisionEntry } from "../orchestration-internal.types";
import type {
  StrategicIntentPayload,
  StrategicIntentRequest,
} from "./strategic-intent-timeline.types";

export const STRATEGIC_INTENT_DECISION_TYPE = "strategic_intent" as const;

type StrategicIntentDecisionEntry = DecisionEntry & {
  strategicIntent: StrategicIntentPayload;
};

function isStrategicIntentEntry(
  entry: DecisionEntry,
): entry is StrategicIntentDecisionEntry {
  return (
    entry.type === STRATEGIC_INTENT_DECISION_TYPE &&
    "strategicIntent" in entry &&
    entry.strategicIntent !== null &&
    typeof entry.strategicIntent === "object"
  );
}

export function appendStrategicIntent(
  log: DecisionEntry[],
  request: StrategicIntentRequest,
  createdAt: string,
): DecisionEntry[] {
  const payload: StrategicIntentPayload = {
    kind: "strategic_intent",
    focus_initiative_id: request.focus_initiative_id,
    rationale: request.rationale,
    planned_next_steps: request.planned_next_steps,
    staleness_actions: request.staleness_actions,
    created_at: createdAt,
  };

  const entry: StrategicIntentDecisionEntry = {
    timestamp: createdAt,
    type: STRATEGIC_INTENT_DECISION_TYPE,
    strategicIntent: payload,
  };

  return [...log, entry];
}

export function latestStrategicIntent(
  log: DecisionEntry[],
): StrategicIntentPayload | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (isStrategicIntentEntry(entry)) {
      return entry.strategicIntent;
    }
  }
  return null;
}
