import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PromotedLesson,
  PromotedLessonsResponse,
  SkillBindingUsage,
} from "@/lib/api/self-improvement.types";
import { usePromotedLessons } from "./usePromotedLessons";

const selfImprovementApiMock = vi.hoisted(() => ({
  fetchPromotedLessons: vi.fn(),
}));

vi.mock("@/lib/api/self-improvement", () => ({
  selfImprovementApi: selfImprovementApiMock,
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

function buildSnapshot(): PromotedLessonsResponse {
  const promoted: PromotedLesson[] = [
    {
      id: "lesson-1",
      sourceSignalId: "signal-group-1",
      promotedAt: "2026-07-01T12:00:00.000Z",
      confidence: 0.88,
      workflowSkillBindingIds: ["binding-a"],
    },
  ];
  const bindings: SkillBindingUsage[] = [
    {
      id: "binding-a",
      mostSpecificSource: "step",
      reuseCount7d: 3,
      workflowStepIds: ["step-1"],
    },
  ];
  return { promoted, bindings };
}

describe("usePromotedLessons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the snapshot resolved by the self-improvement API", async () => {
    const snapshot = buildSnapshot();
    selfImprovementApiMock.fetchPromotedLessons.mockResolvedValue(snapshot);

    const { result } = renderHook(() => usePromotedLessons(), {
      wrapper: createWrapper(newClient()),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(selfImprovementApiMock.fetchPromotedLessons).toHaveBeenCalledTimes(1);
    expect(selfImprovementApiMock.fetchPromotedLessons).toHaveBeenCalledWith({
      since: "7d",
    });
    expect(result.current.data).toEqual(snapshot);
  });

  it("forwards a custom refetch interval to the underlying query", async () => {
    selfImprovementApiMock.fetchPromotedLessons.mockResolvedValue(
      buildSnapshot(),
    );

    const { result } = renderHook(
      () => usePromotedLessons({ refetchInterval: 5_000 }),
      {
        wrapper: createWrapper(newClient()),
      },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(selfImprovementApiMock.fetchPromotedLessons).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(buildSnapshot());
  });

  it("forwards a custom params object to the query key and queryFn", async () => {
    selfImprovementApiMock.fetchPromotedLessons.mockResolvedValue(
      buildSnapshot(),
    );

    const { result } = renderHook(
      () => usePromotedLessons({ params: { since: "24h" } }),
      {
        wrapper: createWrapper(newClient()),
      },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(selfImprovementApiMock.fetchPromotedLessons).toHaveBeenCalledWith({
      since: "24h",
    });
  });
});
