/**
 * Pure helper that wraps the in-process kanban event emitter with
 * the "best-effort emit + warn-on-failure" guard used by the
 * retrospective runner and the failure-threshold trigger. Extracted
 * so the duplicated try/catch/Logger.warn pattern in
 * {@link KanbanRetrospectiveService.emitCooldownSkipped} and
 * {@link KanbanRetrospectiveFailureThresholdService.emitFailureObserved}
 * stops drifting.
 *
 * Work item: ef4d6799-8468-4c4b-b8d6-20e8f0fca384 (M2).
 */

import { Logger } from "@nestjs/common";
import { getKanbanEventEmitter } from "../events/kanban-event-emitter";

/** Minimal emit contract — narrows the `any` returned by
 * `getKanbanEventEmitter` when `eventemitter2` is not installed. */
type EmitterLike = {
  emit: (eventName: string, payload: unknown) => unknown;
};

/**
 * Emit `eventName` + `payload` on the kanban event emitter, logging
 * a warning via `logger` (and swallowing the error) if the
 * underlying emitter throws. Returns `void` on both success and
 * failure so callers can use it as a fire-and-forget primitive.
 */
export function safeEmitKanbanEvent(
  eventName: string,
  payload: unknown,
  logger: Logger,
): void {
  try {
    const emitter = getKanbanEventEmitter() as EmitterLike;
    emitter.emit(eventName, payload);
  } catch (error) {
    logger.warn(
      `Failed to emit ${eventName}: ${formatErrorMessage(error)}`,
    );
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}