/**
 * Event registry for kanban domain events.
 * Exports all event types and constants for the kanban application.
 *
 * This module serves as the central entry point for all kanban event definitions.
 */

// Re-export from types file with backward-compatible aliases
export {
  KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
  KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_VERSION,
  type CycleDecision as LegacyRetrospectiveCycleDecisionType,
  type BoardStateSnapshot,
  type KanbanRetrospectiveCycleDecisionRecordedEvent as RetrospectiveCycleDecisionEvent,
  type CreateKanbanRetrospectiveCycleDecisionEventParams as CreateRetrospectiveCycleDecisionEventParams,
} from "./kanban-retrospective-cycle-decision.types";

// Re-export the new cycle decision event schema
// This is the primary event type for CEO cycle decisions in the learning pipeline
export {
  KANBAN_RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT_TYPE,
  KANBAN_RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT_VERSION,
  isNonTrivialDecision,
  createCycleDecisionEvent,
} from "./cycle-decision.event";
export type {
  CycleDecisionType,
  BoardStateSummary,
  GoalCoverage,
  WorkItemCounts,
  CycleMetadata,
  CycleDecisionEvent,
} from "./cycle-decision.event.types";

// Re-export the new retrospective cycle decision event schema (alias)
export {
  RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
  RETROSPECTIVE_CYCLE_DECISION_EVENT_VERSION,
  isRetrospectiveCycleDecisionNonTrivial,
  createRetrospectiveCycleDecisionEvent,
} from "./retrospective-cycle-decision.event";
export type {
  RetrospectiveCycleDecisionType,
  RetrospectiveCycleDecisionBoardStateSummary,
  RetrospectiveCycleDecisionGoalCoverage,
  RetrospectiveCycleDecisionRecordedEvent,
} from "./retrospective-cycle-decision.event.types";

// Re-export known event types from registry
export {
  KNOWN_KANBAN_EVENT_TYPES,
  type KnownKanbanEventType,
} from "./events-registry.types";
