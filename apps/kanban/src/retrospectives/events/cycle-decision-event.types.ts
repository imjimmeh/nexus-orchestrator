/**
 * Types for Cycle Decision Event Handler.
 *
 * @module retrospectives/events/cycle-decision-event.types
 */

import type { CycleDecisionEvidence } from "../retrospective.types";

/**
 * Stored cycle decision evidence with metadata for aggregation.
 */
export interface StoredCycleDecisionEvidence extends CycleDecisionEvidence {
  /** Unique identifier for this stored evidence */
  evidenceId: string;
  /** ISO 8601 timestamp when the evidence was stored */
  storedAt: string;
  /** Retrospective window this evidence belongs to (ISO date string) */
  windowStart: string;
  windowEnd: string;
}

/**
 * Options for registering the event handler.
 */
export interface CycleDecisionEventHandlerOptions {
  /** Maximum number of cycle decisions to store per project */
  maxStoredDecisionsPerProject?: number;
  /** Retrospective window duration in milliseconds */
  windowDurationMs?: number;
}

/**
 * Kanban Retrospective Cycle Decision Recorded Event Interface.
 * Copied from kanban-retrospective-cycle-decision.types.ts for handler use.
 */
export interface KanbanRetrospectiveCycleDecisionRecordedEvent {
  /** Unique event type identifier */
  event_type: string;
  /** Event schema version */
  event_version: string;
  /** ISO 8601 timestamp when the event was created */
  timestamp: string;
  /** The project scope this event applies to */
  project_id: string;
  /** Type of decision made (blocked, complete, repeat, abandon) */
  decision: "blocked" | "complete" | "repeat" | "abandon";
  /** Human-readable explanation for the decision */
  reason: string;
  /** Unique idempotency key to prevent duplicate processing */
  idempotency_key: string;
  /** Snapshot of board state at decision time */
  board_state_snapshot: {
    /** Total number of work items on the board */
    total_items: number;
    /** Work item counts grouped by their current status */
    items_by_status: Record<string, number>;
    /** Number of work items currently blocked */
    blocked_items: number;
    /** Board completion rate as a percentage (0-100) */
    completion_rate: number;
    /** Goal coverage metrics at decision time */
    goal_coverage: {
      /** Total number of goals */
      total_goals: number;
      /** Number of goals that have work items assigned */
      covered_goals: number;
      /** Array of goal IDs with work items */
      goal_ids: string[];
    };
  };
  /** Metadata about the cycle that just completed */
  cycle_metadata: {
    /** The workflow run that produced this decision */
    workflow_run_id: string | null;
    /** The specific job that made this decision */
    job_id: string | null;
    /** Source of the decision */
    decision_source: "orchestration_cycle" | "manual" | "system";
  };
}
