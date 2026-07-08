/**
 * Event Emitter for Kanban Domain Events.
 *
 * This module provides utility functions for emitting kanban domain events
 * using EventEmitter2 for local event emission.
 *
 * @module kanban-event-emitter
 */

import { EventEmitter2 } from "eventemitter2";
import type { KanbanRetrospectiveCycleDecisionRecordedEvent } from "./kanban-retrospective-cycle-decision.types";
import type { EmitRetrospectiveCycleDecisionOptions } from "./kanban-event-emitter.types";
import {
  createKanbanRetrospectiveCycleDecisionEvent,
  KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
} from "./kanban-retrospective-cycle-decision.types";

// Create a singleton event emitter instance for kanban domain events
const kanbanEventEmitter = new EventEmitter2({
  /**
   * Enable wildcard matching for event names.
   * This allows listeners to subscribe to patterns like 'kanban.*'
   */
  wildcard: true,

  /**
   * Enable verbose event emission logging (useful for debugging).
   * Set to false in production for performance.
   */
  verboseMemoryLeak: false,

  /**
   * Set the delimiter for wildcard matching.
   * Using '.' as delimiter since event names follow 'domain.event.name' pattern.
   */
  delimiter: ".",

  /**
   * Maximum number of listeners allowed per event.
   * Set to a reasonable limit to prevent memory leaks.
   */
  maxListeners: 50,
});

/**
 * Emits a 'kanban.retrospective_cycle_decision_recorded' event.
 *
 * This event fires for non-trivial decisions:
 * - decision is 'blocked', 'complete', or 'abandon' (explicit outcomes)
 * - decision is 'repeat' AND has_board_mutation is true (documented board mutation)
 *
 * The event carries evidence for the learning candidate pipeline,
 * enabling wire CEO cycle decisions into the learning pipeline.
 *
 * @param options - The event payload options
 * @returns The created event that was emitted
 * @throws Error if event emission fails
 *
 * @example
 * ```typescript
 * await emitRetrospectiveCycleDecision({
 *   project_id: "proj-123",
 *   decision: "complete",
 *   reason: "All cycle goals achieved",
 *   idempotency_key: "cycle-2024-01-15-001",
 *   board_state_snapshot: {
 *     total_items: 25,
 *     items_by_status: { "done": 20, "in-progress": 5 },
 *     blocked_items: 0,
 *     completion_rate: 80,
 *     goal_coverage: {
 *       total_goals: 5,
 *       covered_goals: 5,
 *       goal_ids: ["goal-1", "goal-2", "goal-3", "goal-4", "goal-5"]
 *     }
 *   },
 *   cycle_metadata: {
 *     cycle_start: "2024-01-08T00:00:00Z",
 *     cycle_end: "2024-01-15T00:00:00Z",
 *     items_processed: 25,
 *     items_blocked: 2,
 *     items_completed: 20,
 *     has_board_mutation: false
 *   }
 * });
 * ```
 */
export async function emitRetrospectiveCycleDecision(
  options: EmitRetrospectiveCycleDecisionOptions,
): Promise<KanbanRetrospectiveCycleDecisionRecordedEvent> {
  // Create the event using the factory function
  const event = createKanbanRetrospectiveCycleDecisionEvent({
    project_id: options.project_id,
    decision: options.decision,
    reason: options.reason,
    idempotency_key: options.idempotency_key,
    board_state_snapshot: options.board_state_snapshot,
    cycle_metadata: options.cycle_metadata,
  });

  // Emit the event asynchronously using EventEmitter2
  // Using setImmediate to allow the event to be processed in the next tick
  await new Promise<void>((resolve) => {
    setImmediate(() => {
      const listeners = kanbanEventEmitter.listeners(
        KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
      );

      if (listeners.length === 0) {
        // Log warning if no listeners are registered
        console.warn(
          `[KanbanEventEmitter] No listeners registered for event: ${KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE}`,
        );
      }

      // Emit the event
      const emitted = kanbanEventEmitter.emit(
        KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
        event,
      );

      if (!emitted) {
        console.warn(
          `[KanbanEventEmitter] Event emitted but no listeners responded: ${KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE}`,
        );
      }

      resolve();
    });
  });

  return event;
}

/**
 * Gets the singleton event emitter instance for external listeners.
 *
 * @returns The EventEmitter2 instance for kanban events
 *
 * @example
 * ```typescript
 * const emitter = getKanbanEventEmitter();
 *
 * // Listen for retrospective cycle decision events
 * emitter.on('kanban.retrospective_cycle_decision_recorded', (event) => {
 *   console.log('Cycle decision recorded:', event);
 * });
 * ```
 */
export function getKanbanEventEmitter(): EventEmitter2 {
  return kanbanEventEmitter;
}

/**
 * Adds a listener for the retrospective cycle decision event.
 *
 * @param listener - Callback function to invoke when the event is emitted
 * @returns this for chaining
 *
 * @example
 * ```typescript
 * addRetrospectiveCycleDecisionListener((event) => {
 *   console.log('Processing cycle decision:', event.decision);
 * });
 * ```
 */
export function addRetrospectiveCycleDecisionListener(
  listener: (event: KanbanRetrospectiveCycleDecisionRecordedEvent) => void,
): void {
  kanbanEventEmitter.on(
    KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
    listener,
  );
}

/**
 * Removes a listener for the retrospective cycle decision event.
 *
 * @param listener - The callback function to remove
 * @returns this for chaining
 */
export function removeRetrospectiveCycleDecisionListener(
  listener: (event: KanbanRetrospectiveCycleDecisionRecordedEvent) => void,
): void {
  kanbanEventEmitter.off(
    KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
    listener,
  );
}

/**
 * Removes all listeners for the retrospective cycle decision event.
 */
export function removeAllRetrospectiveCycleDecisionListeners(): void {
  kanbanEventEmitter.removeAllListeners(
    KANBAN_RETROSPECTIVE_CYCLE_DECISION_EVENT_TYPE,
  );
}

// Re-export the event type for convenience
export type { KanbanRetrospectiveCycleDecisionRecordedEvent } from "./kanban-retrospective-cycle-decision.types";

// Re-export options type
export type { EmitRetrospectiveCycleDecisionOptions } from "./kanban-event-emitter.types";
