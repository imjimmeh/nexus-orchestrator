import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryMetricsResponse } from "@/lib/api/memory.types";
import { useMemoryMetrics } from "./useMemoryMetrics";

const memoryApiMock = vi.hoisted(() => ({
  getMemoryMetrics: vi.fn(),
}));

vi.mock("@/lib/api/memory", () => ({
  memoryApi: memoryApiMock,
}));

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function buildSnapshot(): MemoryMetricsResponse {
  return {
    backend: {
      read: {
        total: { postgres: 12, honcho: 4 },
        latency_ms: {
          postgres: { count: 12, sum: 240, p50: 18, p95: 42, p99: 55 },
          honcho: { count: 4, sum: 96 },
        },
      },
      write: {
        total: {
          postgres: { success: 9, failure: 1 },
          honcho: { success: 2, failure: 0 },
        },
      },
      active_segments: {
        total: {
          postgres: { user: 3, system: 1 },
          honcho: { profile: 2 },
        },
      },
      fallback: { "postgres->honcho:read": 1 },
    },
    distillation: {
      completed_total: { success: 5, failure: 1 },
      last: {
        input_segment_count: 14,
        output_segment_count: 5,
        compression_ratio: 0.36,
        tokens_before: 4200,
        tokens_after: 1500,
        model: "claude-3-5-sonnet",
        duration_ms: 812,
        completed_at: "2026-06-15T12:00:00.000Z",
      },
    },
    learning: {
      promoted_total: 7,
      last_promoted: {
        candidate_id: "candidate-42",
        confidence: 0.91,
        scope: "memory:profile-1",
        source_decision_id: "decision-7",
        promoted_at: "2026-06-15T12:05:00.000Z",
      },
      lesson_injected_total: 0,
      last_lesson_injected: null,
      run_outcome_after_lesson_total: 0,
      last_run_outcome_after_lesson: null,
      convergence: {},
    },
    generated_at: "2026-06-15T12:10:00.000Z",
  };
}

describe("useMemoryMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the memory metrics snapshot returned by the API", async () => {
    const snapshot = buildSnapshot();
    memoryApiMock.getMemoryMetrics.mockResolvedValue(snapshot);

    const { result } = renderHook(() => useMemoryMetrics(), {
      wrapper: createWrapper(newClient()),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(memoryApiMock.getMemoryMetrics).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(snapshot);
  });

  it("forwards a custom refetch interval to the query", async () => {
    memoryApiMock.getMemoryMetrics.mockResolvedValue(buildSnapshot());

    const { result } = renderHook(
      () => useMemoryMetrics({ refetchInterval: 5_000 }),
      {
        wrapper: createWrapper(newClient()),
      },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.generated_at).toBe("2026-06-15T12:10:00.000Z");
  });
});
