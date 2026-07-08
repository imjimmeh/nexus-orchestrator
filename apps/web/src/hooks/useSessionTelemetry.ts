import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ConnectionState,
  NormalizedTelemetryEvent,
  TelemetryConfig,
  SessionTelemetryConfig,
  SessionTelemetryResult,
} from "./useSessionTelemetry.types";

export type {
  ConnectionState,
  NormalizedTelemetryEvent,
  TelemetryConfig,
  SessionTelemetryConfig,
  SessionTelemetryResult,
};

export function normalizeEvent(value: unknown): NormalizedTelemetryEvent | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  if (typeof raw.event_type !== "string") {
    return null;
  }

  const timestamp =
    typeof raw.timestamp === "string"
      ? raw.timestamp
      : new Date().toISOString();

  const payload =
    raw.payload && typeof raw.payload === "object"
      ? (raw.payload as Record<string, unknown>)
      : {};

  return {
    event_type: raw.event_type,
    timestamp,
    payload,
  };
}

export function eventKey(event: NormalizedTelemetryEvent): string {
  return `${event.timestamp}:${event.event_type}:${JSON.stringify(event.payload)}`;
}

export function dedupeAndSort(
  events: NormalizedTelemetryEvent[],
): NormalizedTelemetryEvent[] {
  const map = new Map<string, NormalizedTelemetryEvent>();
  for (const event of events) {
    map.set(eventKey(event), event);
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

export function mergeNormalizedEvents(
  current: NormalizedTelemetryEvent[],
  incoming: unknown[],
): NormalizedTelemetryEvent[] {
  const normalized = incoming
    .map((entry) => normalizeEvent(entry))
    .filter((entry): entry is NormalizedTelemetryEvent => entry !== null);

  if (normalized.length === 0) {
    return current;
  }

  return dedupeAndSort([...current, ...normalized]);
}

function buildSocketIoConfig(config: TelemetryConfig): TelemetryConfig {
  return {
    wsUrl: config.wsUrl,
    token: config.token,
    reconnectionAttempts: config.reconnectionAttempts ?? 10,
    timeout: config.timeout ?? 10_000,
  };
}

function registerSocketHandlers(
  socket: Socket,
  setConnectionState: (state: ConnectionState) => void,
  setEvents: (updater: (prev: NormalizedTelemetryEvent[]) => NormalizedTelemetryEvent[]) => void,
): () => void {
  socket.on("connect", () => {
    setConnectionState("connected");
  });

  socket.on("disconnect", () => {
    setConnectionState("disconnected");
  });

  socket.on("connect_error", () => {
    setConnectionState("error");
  });

  const onReconnectAttempt = () => setConnectionState("connecting");
  const onReconnectFailed = () => setConnectionState("error");
  socket.io.on("reconnect_attempt", onReconnectAttempt);
  socket.io.on("reconnect_failed", onReconnectFailed);

  socket.on("replay", (payload: unknown) => {
    const replayPayload = Array.isArray(payload) ? payload : [];
    setEvents((current) => mergeNormalizedEvents(current, replayPayload));
  });

  socket.on("event", (payload: unknown) => {
    setEvents((current) => mergeNormalizedEvents(current, [payload]));
  });

  return () => {
    socket.io.off("reconnect_attempt", onReconnectAttempt);
    socket.io.off("reconnect_failed", onReconnectFailed);
  };
}

export function useSessionTelemetry(config: SessionTelemetryConfig): SessionTelemetryResult {
  const { sessionId, historyQuery, authQuery } = config;

  const [events, setEvents] = useState<NormalizedTelemetryEvent[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    setEvents([]);
    setConnectionState(sessionId ? "connecting" : "idle");
  }, [sessionId]);

  const {
    data: history = [],
    isLoading: isLoadingHistory,
    error: historyError,
  } = historyQuery;

  const {
    data: telemetryAuth,
    isLoading: isLoadingAuth,
    error: authError,
  } = authQuery;

  useEffect(() => {
    setEvents((current) => mergeNormalizedEvents(current, history));
  }, [history]);

  useEffect(() => {
    if (!sessionId || connectionState === "connected") {
      return;
    }

    if (history.length > 0 && !isLoadingHistory) {
      setConnectionState("polling");
    }
  }, [sessionId, connectionState, history, isLoadingHistory]);

  useEffect(() => {
    if (!sessionId || !telemetryAuth?.token || !telemetryAuth.wsUrl) {
      return;
    }

    setConnectionState("connecting");

    const socketConfig = buildSocketIoConfig({
      wsUrl: telemetryAuth.wsUrl,
      token: telemetryAuth.token,
    });

    const socket: Socket = io(socketConfig.wsUrl, {
      auth: { token: socketConfig.token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: socketConfig.reconnectionAttempts,
      timeout: socketConfig.timeout,
    });

    socketRef.current = socket;

    const cleanupSocketIoListeners = registerSocketHandlers(
      socket,
      setConnectionState,
      setEvents,
    );

    return () => {
      cleanupSocketIoListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionId, telemetryAuth?.token, telemetryAuth?.wsUrl]);

  const error = useMemo(
    () => historyError || authError || null,
    [historyError, authError],
  );

  const isLoading = isLoadingHistory || isLoadingAuth;

  return {
    events,
    isLoading,
    error,
    connectionState,
  };
}
