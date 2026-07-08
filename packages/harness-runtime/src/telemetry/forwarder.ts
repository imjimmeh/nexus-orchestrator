import type { CanonicalSessionEvent } from "@nexus/core";
import type { OrchestratorClient } from "../gateway/orchestrator-client.js";

/**
 * Creates a telemetry forwarder that emits canonical session events to the
 * orchestrator via the WebSocket client.
 *
 * The returned function accepts a {@link CanonicalSessionEvent} and forwards
 * it to the gateway using `client.emit`.
 */
export function createTelemetryForwarder(
  client: OrchestratorClient,
): (event: CanonicalSessionEvent) => void {
  return (event: CanonicalSessionEvent): void => {
    client.emit(event.type, event);
  };
}
