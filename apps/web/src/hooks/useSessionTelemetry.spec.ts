import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { io } from "socket.io-client";
import {
  normalizeEvent,
  eventKey,
  dedupeAndSort,
  mergeNormalizedEvents,
  useSessionTelemetry,
} from "./useSessionTelemetry";
import type { NormalizedTelemetryEvent } from "./useSessionTelemetry.types";

// ------------------------------------------------------------------
// socket.io-client mock
// ------------------------------------------------------------------
const socketHandlers: Record<
  string,
  ((payload?: unknown) => void) | undefined
> = {};

const ioMockHandlers: Record<string, ((...args: unknown[]) => void) | undefined> = {};

const mockSocket = {
  on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
    socketHandlers[event] = handler;
  }),
  disconnect: vi.fn(),
  io: {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      ioMockHandlers[event] = handler;
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (ioMockHandlers[event] === handler) {
        delete ioMockHandlers[event];
      }
    }),
  },
};

vi.mock("socket.io-client", async () => {
  const actual = await vi.importActual<typeof import("socket.io-client")>("socket.io-client");
  return {
    ...actual,
    io: vi.fn(() => mockSocket),
  };
});

// ------------------------------------------------------------------
// Helper factories
// ------------------------------------------------------------------
function makeEvent(
  overrides: Partial<NormalizedTelemetryEvent> = {},
): NormalizedTelemetryEvent {
  return {
    event_type: "test",
    timestamp: "2026-06-28T00:00:00.000Z",
    payload: {},
    ...overrides,
  };
}

function makeQueryResult<T>(data: T, isLoading = false, error: Error | null = null): import("@tanstack/react-query").UseQueryResult<T, Error> {
  return {
    data,
    isLoading,
    error,
    isError: error !== null,
    isSuccess: !isLoading && error === null,
    status: isLoading ? "pending" : error ? "error" : "success",
    fetchStatus: "idle" as const,
    isPending: isLoading,
    isFetching: false,
    isInitialLoading: isLoading,
    refetch: vi.fn(),
    promise: Promise.resolve(data),
    failureCount: 0,
    failureReason: null,
    isRefetching: false,
    isLoadingError: false,
    isRefetchError: false,
    isPaused: false,
    dataUpdatedAt: Date.now(),
    errorUpdatedAt: 0,
    errorUpdateCount: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
  } as unknown as import("@tanstack/react-query").UseQueryResult<T, Error>;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

// ------------------------------------------------------------------
// Shared helper tests
// ------------------------------------------------------------------
describe("normalizeEvent", () => {
  it("returns null for non-objects", () => {
    expect(normalizeEvent(null)).toBeNull();
    expect(normalizeEvent(undefined)).toBeNull();
    expect(normalizeEvent(42)).toBeNull();
    expect(normalizeEvent("string")).toBeNull();
  });

  it("returns null when event_type is missing or non-string", () => {
    expect(normalizeEvent({})).toBeNull();
    expect(normalizeEvent({ event_type: 42 })).toBeNull();
  });

  it("normalizes a valid event with defaults", () => {
    const result = normalizeEvent({ event_type: "foo" });
    expect(result).toEqual({
      event_type: "foo",
      timestamp: expect.any(String),
      payload: {},
    });
  });

  it("preserves provided timestamp and payload", () => {
    const result = normalizeEvent({
      event_type: "bar",
      timestamp: "2026-01-01T00:00:00.000Z",
      payload: { a: 1 },
    });
    expect(result).toEqual({
      event_type: "bar",
      timestamp: "2026-01-01T00:00:00.000Z",
      payload: { a: 1 },
    });
  });
});

describe("eventKey", () => {
  it("produces a stable key from event fields", () => {
    const event = makeEvent({ event_type: "a", timestamp: "2026-01-01T00:00:00.000Z", payload: { x: 1 } });
    expect(eventKey(event)).toBe("2026-01-01T00:00:00.000Z:a:{\"x\":1}");
  });
});

describe("dedupeAndSort", () => {
  it("removes duplicate events by key", () => {
    const e1 = makeEvent({ event_type: "a", timestamp: "2026-01-01T00:00:00.000Z" });
    const e2 = makeEvent({ event_type: "a", timestamp: "2026-01-01T00:00:00.000Z" });
    const e3 = makeEvent({ event_type: "b", timestamp: "2026-01-02T00:00:00.000Z" });

    const result = dedupeAndSort([e1, e2, e3]);
    expect(result).toHaveLength(2);
    expect(result[0].event_type).toBe("a");
    expect(result[1].event_type).toBe("b");
  });

  it("sorts events by timestamp ascending", () => {
    const e1 = makeEvent({ timestamp: "2026-01-02T00:00:00.000Z" });
    const e2 = makeEvent({ timestamp: "2026-01-01T00:00:00.000Z" });
    const e3 = makeEvent({ timestamp: "2026-01-03T00:00:00.000Z" });

    const result = dedupeAndSort([e1, e2, e3]);
    expect(result.map((e) => e.timestamp)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
    ]);
  });
});

describe("mergeNormalizedEvents", () => {
  it("returns current when incoming is empty", () => {
    const current = [makeEvent()];
    expect(mergeNormalizedEvents(current, [])).toBe(current);
  });

  it("returns current when incoming has no valid events", () => {
    const current = [makeEvent()];
    expect(mergeNormalizedEvents(current, [null, 42, "bad"])).toBe(current);
  });

  it("merges and dedupes incoming events with current", () => {
    const current = [makeEvent({ event_type: "a", timestamp: "2026-01-01T00:00:00.000Z" })];
    const incoming = [
      { event_type: "a", timestamp: "2026-01-01T00:00:00.000Z" }, // duplicate
      { event_type: "b", timestamp: "2026-01-02T00:00:00.000Z" },
    ];

    const result = mergeNormalizedEvents(current, incoming);
    expect(result).toHaveLength(2);
    expect(result[0].event_type).toBe("a");
    expect(result[1].event_type).toBe("b");
  });
});

// ------------------------------------------------------------------
// useSessionTelemetry hook tests
// ------------------------------------------------------------------
describe("useSessionTelemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(socketHandlers).forEach((key) => delete socketHandlers[key]);
    Object.keys(ioMockHandlers).forEach((key) => delete ioMockHandlers[key]);
  });

  it("returns idle state when no sessionId is provided", () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([]);
    const authQuery = makeQueryResult(null);

    const { result } = renderHook(
      () => useSessionTelemetry({ sessionId: undefined, historyQuery, authQuery }),
      { wrapper },
    );

    expect(result.current.connectionState).toBe("idle");
    expect(result.current.events).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("transitions to connecting when sessionId is provided", () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([]);
    const authQuery = makeQueryResult(null);

    const { result } = renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    expect(result.current.connectionState).toBe("connecting");
  });

  it("transitions to polling when history arrives and auth is still loading", async () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([makeEvent()], false);
    const authQuery = makeQueryResult(null, true);

    const { result } = renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.connectionState).toBe("polling");
    });
  });

  it("merges history events into state", () => {
    const wrapper = createWrapper();
    const history = [makeEvent({ event_type: "hist", timestamp: "2026-01-01T00:00:00.000Z" })];
    const historyQuery = makeQueryResult(history);
    const authQuery = makeQueryResult(null);

    const { result } = renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].event_type).toBe("hist");
  });

  it("opens a socket when auth resolves with token and wsUrl", async () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([]);
    const authQuery = makeQueryResult({ token: "tok-1", wsUrl: "ws://test" });

    renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    await waitFor(() => {
      expect(vi.mocked(io)).toHaveBeenCalledWith(
        "ws://test",
        expect.objectContaining({
          auth: { token: "tok-1" },
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: 10,
          timeout: 10_000,
        }),
      );
    });
  });

  it("transitions to connected on socket connect", async () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([]);
    const authQuery = makeQueryResult({ token: "tok-1", wsUrl: "ws://test" });

    const { result } = renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    await waitFor(() => {
      expect(socketHandlers["connect"]).toBeDefined();
    });

    act(() => {
      socketHandlers["connect"]?.();
    });

    expect(result.current.connectionState).toBe("connected");
  });

  it("transitions to disconnected on socket disconnect", async () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([]);
    const authQuery = makeQueryResult({ token: "tok-1", wsUrl: "ws://test" });

    const { result } = renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    await waitFor(() => expect(socketHandlers["connect"]).toBeDefined());
    act(() => {
      socketHandlers["connect"]?.();
    });
    expect(result.current.connectionState).toBe("connected");

    await waitFor(() => expect(socketHandlers["disconnect"]).toBeDefined());
    act(() => {
      socketHandlers["disconnect"]?.();
    });

    expect(result.current.connectionState).toBe("disconnected");
  });

  it("transitions to error on connect_error", async () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([]);
    const authQuery = makeQueryResult({ token: "tok-1", wsUrl: "ws://test" });

    const { result } = renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    await waitFor(() => expect(socketHandlers["connect_error"]).toBeDefined());
    act(() => {
      socketHandlers["connect_error"]?.();
    });

    expect(result.current.connectionState).toBe("error");
  });

  it("transitions to connecting on reconnect_attempt", async () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([]);
    const authQuery = makeQueryResult({ token: "tok-1", wsUrl: "ws://test" });

    const { result } = renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    await waitFor(() => expect(ioMockHandlers["reconnect_attempt"]).toBeDefined());
    act(() => {
      ioMockHandlers["reconnect_attempt"]?.();
    });

    expect(result.current.connectionState).toBe("connecting");
  });

  it("transitions to error on reconnect_failed", async () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([]);
    const authQuery = makeQueryResult({ token: "tok-1", wsUrl: "ws://test" });

    const { result } = renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    await waitFor(() => expect(ioMockHandlers["reconnect_failed"]).toBeDefined());
    act(() => {
      ioMockHandlers["reconnect_failed"]?.();
    });

    expect(result.current.connectionState).toBe("error");
  });

  it("merges replay events via socket replay handler", async () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([]);
    const authQuery = makeQueryResult({ token: "tok-1", wsUrl: "ws://test" });

    const { result } = renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    await waitFor(() => expect(socketHandlers["replay"]).toBeDefined());

    act(() => {
      socketHandlers["replay"]?.([
        { event_type: "replay-a", timestamp: "2026-01-01T00:00:00.000Z", payload: {} },
      ]);
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].event_type).toBe("replay-a");
  });

  it("merges live events via socket event handler", async () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([]);
    const authQuery = makeQueryResult({ token: "tok-1", wsUrl: "ws://test" });

    const { result } = renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    await waitFor(() => expect(socketHandlers["event"]).toBeDefined());

    act(() => {
      socketHandlers["event"]?.({
        event_type: "live-a",
        timestamp: "2026-01-02T00:00:00.000Z",
        payload: { x: 1 },
      });
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].event_type).toBe("live-a");
  });

  it("disconnects and cleans up socket on unmount", async () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([]);
    const authQuery = makeQueryResult({ token: "tok-1", wsUrl: "ws://test" });

    const { unmount } = renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    await waitFor(() => expect(vi.mocked(io)).toHaveBeenCalled());
    unmount();
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it("resets events and state when sessionId changes", () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([]);
    const authQuery = makeQueryResult(null);

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string | undefined }) =>
        useSessionTelemetry({ sessionId, historyQuery, authQuery }),
      { wrapper, initialProps: { sessionId: "sess-1" } },
    );

    expect(result.current.events).toEqual([]);
    expect(result.current.connectionState).toBe("connecting");

    rerender({ sessionId: "sess-2" });

    expect(result.current.events).toEqual([]);
    expect(result.current.connectionState).toBe("connecting");
  });

  it("exposes error from historyQuery or authQuery", () => {
    const wrapper = createWrapper();
    const historyError = new Error("history failed");
    const historyQuery = makeQueryResult([], false, historyError);
    const authQuery = makeQueryResult(null);

    const { result } = renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    expect(result.current.error).toBe(historyError);
  });

  it("exposes isLoading when either query is loading", () => {
    const wrapper = createWrapper();
    const historyQuery = makeQueryResult([], true);
    const authQuery = makeQueryResult(null, false);

    const { result } = renderHook(
      () => useSessionTelemetry({ sessionId: "sess-1", historyQuery, authQuery }),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
  });
});
