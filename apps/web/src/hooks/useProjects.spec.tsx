import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDeleteProject, useProjectList } from "./useProjects";

const apiMock = vi.hoisted(() => ({
  getProjects: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: apiMock,
}));

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads projects", async () => {
    apiMock.getProjects.mockResolvedValueOnce([
      { id: "project-1", name: "Nexus", created_at: "", updated_at: "" },
    ]);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const { result } = renderHook(() => useProjectList(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiMock.getProjects).toHaveBeenCalledOnce();
    expect(result.current.data?.[0]?.id).toBe("project-1");
  });

  it("deletes a project and clears cached detail entry", async () => {
    apiMock.deleteProject.mockResolvedValueOnce(undefined);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
    const removeQueriesSpy = vi.spyOn(queryClient, "removeQueries");

    const { result } = renderHook(() => useDeleteProject(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync("project-1");
    });

    expect(apiMock.deleteProject).toHaveBeenCalledWith("project-1");
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: ["projects"],
    });
    expect(removeQueriesSpy).toHaveBeenCalledWith({
      queryKey: ["projects", "project-1"],
    });
  });
});
