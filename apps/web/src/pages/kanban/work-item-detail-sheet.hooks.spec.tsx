import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { useRestartExecutionMutation } from "./work-item-detail-sheet.hooks";
import { api } from "@/lib/api/client";
import { WorkItem } from "@/lib/api/work-items.types";
import type { ReactNode } from "react";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => toastMock,
}));

vi.mock("@/lib/api/client", () => ({
  api: {
    restartWorkItemExecution: vi.fn(),
  },
}));

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi-1",
    project_id: "project-1",
    title: "Test work item",
    description: "A description",
    status: "in-progress",
    type: "story",
    priority: "p2",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as WorkItem;
}

describe("useRestartExecutionMutation", () => {
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

  it("shows an info toast immediately when the mutation starts", async () => {
    const item = makeWorkItem();
    vi.mocked(api.restartWorkItemExecution).mockResolvedValue({
      workItem: item,
      triggeredRunIds: [],
    });

    const { result } = renderHook(
      () => useRestartExecutionMutation({ queryClient }),
      { wrapper },
    );

    result.current.mutate(item);

    await waitFor(() => {
      expect(toastMock.info).toHaveBeenCalledWith(
        "Retriggering execution",
        'For "Test work item"',
      );
    });
  });

  it("shows a success toast when the API call succeeds", async () => {
    const item = makeWorkItem();
    vi.mocked(api.restartWorkItemExecution).mockResolvedValue({
      workItem: item,
      triggeredRunIds: [],
    });

    const { result } = renderHook(
      () => useRestartExecutionMutation({ queryClient }),
      { wrapper },
    );

    await result.current.mutateAsync(item);

    expect(toastMock.success).toHaveBeenCalledWith(
      "Execution retriggered",
      'For "Test work item"',
    );
  });

  it("shows an error toast when the API call fails", async () => {
    const item = makeWorkItem();
    vi.mocked(api.restartWorkItemExecution).mockRejectedValue(
      new Error("Network error"),
    );

    const { result } = renderHook(
      () => useRestartExecutionMutation({ queryClient }),
      { wrapper },
    );

    await expect(result.current.mutateAsync(item)).rejects.toThrow(
      "Network error",
    );

    expect(toastMock.error).toHaveBeenCalledWith(
      "Failed to retrigger execution",
      "Network error",
    );
  });
});
