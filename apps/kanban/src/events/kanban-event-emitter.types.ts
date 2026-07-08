/**
 * Types for Kanban Event Emitter.
 *
 * @module kanban-event-emitter.types
 */

import type {
  BoardStateSnapshot,
  CycleMetadata,
} from "./kanban-retrospective-cycle-decision.types";

/**
 * Options for emitting the retrospective cycle decision event.
 */
export interface EmitRetrospectiveCycleDecisionOptions {
  /** The project scope this event applies to */
  project_id: string;
  /** Type of decision made (blocked, complete, repeat, abandon) */
  decision: "blocked" | "complete" | "repeat" | "abandon";
  /** Human-readable explanation for the decision */
  reason: string;
  /** Unique idempotency key to prevent duplicate processing */
  idempotency_key: string;
  /** Snapshot of board state at decision time */
  board_state_snapshot: BoardStateSnapshot;
  /** Metadata about the cycle that just completed */
  cycle_metadata: CycleMetadata;
}
