/**
 * Retrospectives module barrel export.
 *
 * This module serves as the central entry point for all retrospectives-related
 * types, services, and utilities.
 *
 * @module retrospectives
 */

// Types and Enums
export {
  DecisionType,
  type BoardStateSummary,
  type WorkItemCounts,
  type GoalCoverage,
  type CycleDecisionProvenance,
  type CycleDecisionMetadata,
  type CycleMetadata,
  type RetrospectiveCycleDecisionRecordedEvent,
} from "./types/cycle-decision.types";

// Services
export { KanbanRetrospectiveService } from "./kanban-retrospective.service";
export { KanbanRetrospectiveEvidenceService } from "./kanban-retrospective-evidence.service";

// Event Handler
export {
  CycleDecisionEventHandler,
  type StoredCycleDecisionEvidence,
  type CycleDecisionEventHandlerOptions,
} from "./events/cycle-decision-event.handler";

// Events
export {
  CYCLE_DECISION_RECORDED_EVENT_NAME,
  type KanbanDomainEvent,
  type CycleDecisionRecordedEventPayload,
  type CycleDecisionRecordedEvent,
  createCycleDecisionRecordedEvent,
  CycleDecisionRecordedEventClass,
} from "./events/cycle-decision.recorded.event";

// Cycle Decision Metadata Extractor
export {
  extractCycleDecisionMetadata,
  extractWorkItemCounts,
  extractGoalCoverage,
  extractBoardStateSummary,
  determineHasBoardMutation,
  isNonTrivialCycleDecision,
  createCycleMetadata,
  EMPTY_BOARD_STATE,
  type ExtractCycleDecisionMetadataParams,
  type CycleDecisionMetadataResult,
} from "./cycle-decision-metadata";
