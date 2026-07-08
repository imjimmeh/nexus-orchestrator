import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { api } from "@/lib/api/client";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { queryKeys } from "@/lib/queryKeys";

type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "polling"
  | "disconnected"
  | "error";

function normalizeEvent(value: unknown): WorkflowTelemetryEvent | null {
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

function eventKey(event: WorkflowTelemetryEvent): string {
  return `${event.timestamp}:${event.event_type}:${JSON.stringify(event.payload)}`;
}

function dedupeAndSort(
  events: WorkflowTelemetryEvent[],
): WorkflowTelemetryEvent[] {
  const map = new Map<string, WorkflowTelemetryEvent>();
  for (const event of events) {
    map.set(eventKey(event), event);
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

function mergeNormalizedEvents(
  current: WorkflowTelemetryEvent[],
  incoming: unknown[],
): WorkflowTelemetryEvent[] {
  const normalized = incoming
    .map((entry) => normalizeEvent(entry))
    .filter((entry): entry is WorkflowTelemetryEvent => entry !== null);

  if (normalized.length === 0) {
    return current;
  }

  return dedupeAndSort([...current, ...normalized]);
}

function useChatSessionHistory(
  sessionId: string | undefined,
  connectionState: ConnectionState,
) {
  return useQuery({
    queryKey: queryKeys.chatSessions.events(sessionId ?? ""),
    queryFn: async () => {
      if (!sessionId) {
        return [];
      }
      return api.getChatSessionEvents(sessionId);
    },
    enabled: !!sessionId,
    refetchInterval: connectionState === "connected" ? 10_000 : 2_000,
  });
}

function useChatSessionTelemetryAuth(sessionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.chatSessions.telemetryAuth(sessionId ?? ""),
    queryFn: async () => {
      if (!sessionId) {
        return null;
      }
      return api.getChatSessionTelemetryAuth(sessionId);
    },
    enabled: !!sessionId,
  });
}

function registerSocketHandlers(
  socket: Socket,
  setConnectionState: (state: ConnectionState) => void,
  setEvents: Dispatch<SetStateAction<WorkflowTelemetryEvent[]>>,
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

export function useChatSessionTelemetry(sessionId?: string) {
  const [events, setEvents] = useState<WorkflowTelemetryEvent[]>([]);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");

  useEffect(() => {
    setEvents([]);
    setConnectionState(sessionId ? "connecting" : "idle");
  }, [sessionId]);

  const {
    data: history = [],
    isLoading: isLoadingHistory,
    error: historyError,
  } = useChatSessionHistory(sessionId, connectionState);

  const {
    data: telemetryAuth,
    isLoading: isLoadingAuth,
    error: authError,
  } = useChatSessionTelemetryAuth(sessionId);

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

    const socket: Socket = io(telemetryAuth.wsUrl, {
      auth: { token: telemetryAuth.token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      timeout: 10_000,
    });

    const cleanupSocketIoListeners = registerSocketHandlers(
      socket,
      setConnectionState,
      setEvents,
    );

    return () => {
      cleanupSocketIoListeners();
      socket.disconnect();
    };
  }, [sessionId, telemetryAuth?.token, telemetryAuth?.wsUrl]);

  const error = useMemo(
    () => historyError || authError,
    [historyError, authError],
  );

  return {
    events,
    isLoading: isLoadingHistory || isLoadingAuth,
    error,
    connectionState,
  };
}
