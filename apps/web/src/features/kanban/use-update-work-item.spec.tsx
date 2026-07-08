import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { api } from "@/lib/api/client";
import { WorkItem } from "@/lib/api/work-items.types";
import { useUpdateWorkItem } from "./use-update-work-item";

vi.mock("@/lib/api/client", () => ({
  api: {
    updateWorkItem: vi.fn(),
  },
}));

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi-1",
    project_id: "project-1",
    title: "Test work item",
    description: null,
    status: "in-progress",
    type: "task",
    priority: "p2",
    storyPoints: null,
    rolledUpPoints: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as WorkItem;
}

describe("useUpdateWorkItem", () => {
  let queryClient: QueryClient;

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  it("calls api.updateWorkItem with the given project, work item id, and data", async () => {
    const updatedItem = makeWorkItem({ storyPoints: 8 });
    vi.mocked(api.updateWorkItem).mockResolvedValue(updatedItem);

    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper });

    await result.current.mutateAsync({
      projectId: "project-1",
      workItemId: "wi-1",
      data: { storyPoints: 8 },
    });

    expect(api.updateWorkItem).toHaveBeenCalledWith("project-1", "wi-1", {
      storyPoints: 8,
    });
  });

  it("updates the cached work item list on success", async () => {
    const initialItem = makeWorkItem({ storyPoints: 3 });
    const updatedItem = makeWorkItem({ storyPoints: 8 });
    queryClient.setQueryData(
      ["project-work-items", "project-1"],
      [initialItem],
    );
    vi.mocked(api.updateWorkItem).mockResolvedValue(updatedItem);

    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper });

    result.current.mutate({
      projectId: "project-1",
      workItemId: "wi-1",
      data: { storyPoints: 8 },
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData(["project-work-items", "project-1"]),
      ).toEqual([updatedItem]);
    });
  });
});
