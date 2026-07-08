export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "polling"
  | "disconnected"
  | "error";

export interface TelemetryConfig {
  wsUrl: string;
  token: string;
  reconnectionAttempts?: number;
  timeout?: number;
}

export interface NormalizedTelemetryEvent {
  event_type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface SessionTelemetryConfig {
  sessionId: string | undefined;
  historyQuery: import("@tanstack/react-query").UseQueryResult<
    NormalizedTelemetryEvent[],
    Error
  >;
  authQuery: import("@tanstack/react-query").UseQueryResult<
    { token: string; wsUrl: string } | null,
    Error
  >;
}

export interface SessionTelemetryResult {
  events: NormalizedTelemetryEvent[];
  isLoading: boolean;
  error: Error | null;
  connectionState: ConnectionState;
}
