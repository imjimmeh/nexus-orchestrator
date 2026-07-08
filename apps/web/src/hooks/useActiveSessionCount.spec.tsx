import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useActiveSessionCount } from "./useActiveSessionCount";

const apiMock = vi.hoisted(() => ({
  getChatSessions: vi.fn(),
  getWorkflowRuns: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: apiMock,
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

describe("useActiveSessionCount", () => {
  it("sums the reported totals from chat sessions and workflow runs", async () => {
    apiMock.getChatSessions.mockResolvedValue({
      success: true,
      data: [{ id: "only-one-row-returned" }],
      meta: { pagination: { total: 3, limit: 1, offset: 0 } },
    });
    apiMock.getWorkflowRuns.mockResolvedValue({
      success: true,
      data: [],
      meta: { pagination: { total: 4, limit: 1, offset: 0 } },
    });

    const { result } = renderHook(() => useActiveSessionCount(), {
      wrapper: createWrapper(newClient()),
    });

    await waitFor(() => {
      expect(result.current).toBe(7);
    });
  });

  it("uses the pagination total, not the returned page length", async () => {
    // The page is capped at the request limit; the badge must reflect the true
    // total, never the (smaller) number of rows in the returned page.
    apiMock.getChatSessions.mockResolvedValue({
      success: true,
      data: [{ id: "row" }],
      meta: { pagination: { total: 156, limit: 1, offset: 0 } },
    });
    apiMock.getWorkflowRuns.mockResolvedValue({
      success: true,
      data: [],
      meta: { pagination: { total: 0, limit: 1, offset: 0 } },
    });

    const { result } = renderHook(() => useActiveSessionCount(), {
      wrapper: createWrapper(newClient()),
    });

    await waitFor(() => {
      expect(result.current).toBe(156);
    });
  });

  it("requests only active statuses for each source", async () => {
    apiMock.getChatSessions.mockResolvedValue({
      success: true,
      data: [],
      meta: { pagination: { total: 0, limit: 1, offset: 0 } },
    });
    apiMock.getWorkflowRuns.mockResolvedValue({
      success: true,
      data: [],
      meta: { pagination: { total: 0, limit: 1, offset: 0 } },
    });

    renderHook(() => useActiveSessionCount(), {
      wrapper: createWrapper(newClient()),
    });

    await waitFor(() => {
      expect(apiMock.getChatSessions).toHaveBeenCalledWith(
        expect.objectContaining({ status: "RUNNING,STARTING" }),
      );
      expect(apiMock.getWorkflowRuns).toHaveBeenCalledWith(
        expect.objectContaining({ status: "RUNNING,PENDING" }),
      );
    });
  });

  it("falls back to 0 before data resolves", () => {
    apiMock.getChatSessions.mockReturnValue(new Promise(() => {}));
    apiMock.getWorkflowRuns.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useActiveSessionCount(), {
      wrapper: createWrapper(newClient()),
    });

    expect(result.current).toBe(0);
  });
});
