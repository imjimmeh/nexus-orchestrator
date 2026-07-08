import { COMMAND_OUTPUT_EVENT } from '@nexus/core';
import type {
  CommandGatewayDeps,
  CommandEventType,
} from './command-output-gateway.helpers.types';

export type { CommandGatewayDeps, CommandEventType };

function buildEvent(
  event_type: string,
  payload: Record<string, unknown>,
): { event_type: string; payload: Record<string, unknown>; timestamp: string } {
  return { event_type, payload, timestamp: new Date().toISOString() };
}

/**
 * Dispatches a command telemetry event with the correct persistence policy:
 * - `command_started` and `command_finished`: persisted **and** published.
 * - `command_output`: published live only — high-volume chunks must not evict
 *   other events from the capped replay stream; replay viewers reconstruct
 *   context from `command_started` + `command_finished.outputTail`.
 */
export async function dispatchCommandGatewayEvent(
  eventType: CommandEventType,
  deps: CommandGatewayDeps,
): Promise<void> {
  const event = buildEvent(eventType, deps.payload);
  if (eventType !== COMMAND_OUTPUT_EVENT) {
    await deps.streamService.persistEvent(deps.workflowRunId, event);
  }
  await deps.pubsubService.publishEvent(deps.workflowRunId, event);
}

/** Persists and publishes `command_started` — kept in the replay stream. */
export async function handleCommandStartedGatewayCompat(
  deps: CommandGatewayDeps,
): Promise<void> {
  await dispatchCommandGatewayEvent('command_started', deps);
}

/**
 * Publishes `command_output` live — intentionally NOT persisted.
 *
 * High-volume stdout/stderr chunks would saturate the capped replay stream and
 * evict other events. Replay viewers reconstruct context from `command_started`
 * and the bounded `outputTail` in `command_finished` instead.
 */
export async function handleCommandOutputGatewayCompat(
  deps: CommandGatewayDeps,
): Promise<void> {
  await dispatchCommandGatewayEvent('command_output', deps);
}

/** Persists and publishes `command_finished` — kept in the replay stream. */
export async function handleCommandFinishedGatewayCompat(
  deps: CommandGatewayDeps,
): Promise<void> {
  await dispatchCommandGatewayEvent('command_finished', deps);
}
