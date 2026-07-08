import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  useProjectOrchestrationState,
  useStartProjectOrchestration,
} from "./useProjectOrchestration";

const apiMock = vi.hoisted(() => ({
  getProjectOrchestrationState: vi.fn(),
  startProjectOrchestration: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: apiMock,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useProjectOrchestration", () => {
  it("loads orchestration state", async () => {
    apiMock.getProjectOrchestrationState.mockResolvedValueOnce({
      orchestration: null,
      projectState: {
        project_id: "project-1",
        totalCount: 0,
        activeCount: 0,
        groupedByStatus: {},
      },
      pendingActionRequests: [],
    });

    const { result } = renderHook(
      () => useProjectOrchestrationState("project-1"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiMock.getProjectOrchestrationState).toHaveBeenCalledWith(
      "project-1",
    );
    expect(result.current.data?.projectState.project_id).toBe("project-1");
  });

  it("starts orchestration with goals and mode", async () => {
    apiMock.startProjectOrchestration.mockResolvedValueOnce({
      id: "orch-1",
      project_id: "project-1",
      status: "initializing",
      goals: "Ship orchestration UX",
      revisionFeedback: null,
      orchestrationMode: "supervised",
      strategySummary: null,
      currentWorkflowRunId: null,
      decisionLog: [],
      metadata: null,
      created_at: "2026-04-04T10:00:00.000Z",
      updated_at: "2026-04-04T10:00:00.000Z",
    });

    const { result } = renderHook(
      () => useStartProjectOrchestration("project-1"),
      { wrapper: createWrapper() },
    );

    result.current.mutate({
      goals: "Ship orchestration UX",
      orchestrationMode: "supervised",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiMock.startProjectOrchestration).toHaveBeenCalledWith(
      "project-1",
      {
        goals: "Ship orchestration UX",
        orchestrationMode: "supervised",
      },
    );
  });
});
