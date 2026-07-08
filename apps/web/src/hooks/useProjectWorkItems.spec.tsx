import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { WorkItem } from "@/lib/api/work-items.types";
import { useProjectWorkItems } from "./useProjectWorkItems";

const apiMock = vi.hoisted(() => ({
  getProjectWorkItems: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: apiMock,
}));

interface WrapperBundle {
  queryClient: QueryClient;
  wrapper: ({ children }: { children: ReactNode }) => ReactNode;
}

function createWrapper(): WrapperBundle {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    queryClient,
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

function makeWorkItem(id: string): WorkItem {
  return {
    id,
    project_id: "project-1",
    title: `Work item ${id}`,
    description: null,
    status: "todo",
    type: "story",
    priority: "medium",
    assignedAgentId: null,
    tokenSpend: 0,
    costCents: 0,
    currentExecutionId: null,
    waitingForInput: false,
    executionConfig: null,
    metadata: null,
    lastExecutionStatus: null,
    dependsOn: [],
    blocks: [],
    blockers: [],
    subtasks: [],
    created_at: "2026-04-06T10:00:00.000Z",
    updated_at: "2026-04-06T10:00:00.000Z",
  };
}

describe("useProjectWorkItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns work items for the project and forwards the default limit", async () => {
    const items = [makeWorkItem("wi-1"), makeWorkItem("wi-2")];
    apiMock.getProjectWorkItems.mockResolvedValueOnce({
      items,
      total: 2,
      limit: 200,
      offset: 0,
    });

    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useProjectWorkItems("project-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiMock.getProjectWorkItems).toHaveBeenCalledTimes(1);
    expect(apiMock.getProjectWorkItems).toHaveBeenCalledWith("project-1", {
      limit: 200,
      offset: 0,
    });
    expect(result.current.data).toEqual(items);
  });

  it("fetches every page by default so relationship lookups have all project work items", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) =>
      makeWorkItem(`wi-${index + 1}`),
    );
    const secondPage = [makeWorkItem("wi-201")];

    apiMock.getProjectWorkItems
      .mockResolvedValueOnce({
        items: firstPage,
        total: 201,
        limit: 200,
        offset: 0,
      })
      .mockResolvedValueOnce({
        items: secondPage,
        total: 201,
        limit: 200,
        offset: 200,
      });

    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useProjectWorkItems("project-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiMock.getProjectWorkItems).toHaveBeenNthCalledWith(
      1,
      "project-1",
      {
        limit: 200,
        offset: 0,
      },
    );
    expect(apiMock.getProjectWorkItems).toHaveBeenNthCalledWith(
      2,
      "project-1",
      {
        limit: 200,
        offset: 200,
      },
    );
    expect(result.current.data).toEqual([...firstPage, ...secondPage]);
  });

  it("forwards a custom limit to the api call", async () => {
    apiMock.getProjectWorkItems.mockResolvedValueOnce({
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });

    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useProjectWorkItems("project-1", { limit: 25 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiMock.getProjectWorkItems).toHaveBeenCalledWith("project-1", {
      limit: 25,
    });
    expect(result.current.data).toEqual([]);
  });

  it("appends the scope to the query key and keeps scoped caches separate", async () => {
    apiMock.getProjectWorkItems
      .mockResolvedValueOnce({
        items: [makeWorkItem("default-1")],
        total: 1,
        limit: 200,
        offset: 0,
      })
      .mockResolvedValueOnce({
        items: [makeWorkItem("goal-link-1")],
        total: 1,
        limit: 200,
        offset: 0,
      });

    const { queryClient, wrapper } = createWrapper();

    const defaultHook = renderHook(
      () => useProjectWorkItems("project-1", { scope: "default" }),
      { wrapper },
    );
    const goalLinkHook = renderHook(
      () => useProjectWorkItems("project-1", { scope: "goal-link-picker" }),
      { wrapper },
    );

    await waitFor(() =>
      expect(defaultHook.result.current.isSuccess).toBe(true),
    );
    await waitFor(() =>
      expect(goalLinkHook.result.current.isSuccess).toBe(true),
    );

    expect(apiMock.getProjectWorkItems).toHaveBeenNthCalledWith(
      1,
      "project-1",
      { limit: 200, offset: 0 },
    );
    expect(apiMock.getProjectWorkItems).toHaveBeenNthCalledWith(
      2,
      "project-1",
      { limit: 200, offset: 0 },
    );

    const expectedDefaultKey = queryKeys.projectWorkItems.list(
      "project-1",
      "default",
    );
    const expectedGoalLinkKey = queryKeys.projectWorkItems.list(
      "project-1",
      "goal-link-picker",
    );

    expect(expectedDefaultKey).toEqual([
      "project-work-items",
      "project-1",
      "default",
    ]);
    expect(expectedGoalLinkKey).toEqual([
      "project-work-items",
      "project-1",
      "goal-link-picker",
    ]);

    const defaultCached =
      queryClient.getQueryData<WorkItem[]>(expectedDefaultKey);
    const goalLinkCached =
      queryClient.getQueryData<WorkItem[]>(expectedGoalLinkKey);

    expect(defaultCached?.map((item) => item.id)).toEqual(["default-1"]);
    expect(goalLinkCached?.map((item) => item.id)).toEqual(["goal-link-1"]);

    queryClient.setQueryData<WorkItem[]>(expectedDefaultKey, [
      makeWorkItem("default-override"),
    ]);

    expect(
      queryClient
        .getQueryData<WorkItem[]>(expectedDefaultKey)
        ?.map((item) => item.id),
    ).toEqual(["default-override"]);
    expect(
      queryClient
        .getQueryData<WorkItem[]>(expectedGoalLinkKey)
        ?.map((item) => item.id),
    ).toEqual(["goal-link-1"]);
  });

  it("skips the fetch when enabled is false", async () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useProjectWorkItems("project-1", { enabled: false }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(apiMock.getProjectWorkItems).not.toHaveBeenCalled();
    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("forwards refetchInterval to the underlying query", async () => {
    apiMock.getProjectWorkItems.mockResolvedValue({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    });

    const { queryClient, wrapper } = createWrapper();

    const { result } = renderHook(
      () => useProjectWorkItems("project-1", { refetchInterval: 7_500 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Inspect the queryCache directly: the QueryObserver (which carries
    // refetchInterval in its observer options) is mounted on the cached
    // query. This is the most reliable signal that useQuery received the
    // option from the hook.
    const expectedKey = queryKeys.projectWorkItems.list("project-1");
    const cachedQuery = queryClient
      .getQueryCache()
      .find({ queryKey: expectedKey });

    expect(cachedQuery).toBeDefined();
    const observers = cachedQuery?.observers ?? [];
    expect(observers.length).toBeGreaterThan(0);

    const refetchIntervalValues = observers.map(
      (observer) => observer.options.refetchInterval,
    );
    expect(refetchIntervalValues).toContain(7_500);

    expect(apiMock.getProjectWorkItems).toHaveBeenCalledWith("project-1", {
      limit: 200,
      offset: 0,
    });
  });
});
