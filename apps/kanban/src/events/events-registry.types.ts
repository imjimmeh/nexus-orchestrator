/**
 * Event registry types for Kanban domain events.
 *
 * @module events-registry.types
 */

/**
 * Known kanban event types.
 * Used for validation and event routing.
 */
export const KNOWN_KANBAN_EVENT_TYPES = [
  "kanban.retrospective_cycle_decision_recorded",
] as const;

export type KnownKanbanEventType = (typeof KNOWN_KANBAN_EVENT_TYPES)[number];
