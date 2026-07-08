/**
 * Resolves the WebSocket URL to advertise to clients.
 * Priority: TELEMETRY_PUBLIC_WS_URL > TELEMETRY_WS_URL > WEBSOCKET_URL
 */
export function resolveWebSocketUrl(): string | null {
  return (
    process.env.TELEMETRY_PUBLIC_WS_URL?.trim() ||
    process.env.TELEMETRY_WS_URL?.trim() ||
    process.env.WEBSOCKET_URL?.trim() ||
    null
  );
}
