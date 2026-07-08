import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useScopedAiDefault,
  useSetScopedAiDefault,
} from "./useScopedAiDefaults";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock("@/lib/api/client", () => ({ api: apiMock }));

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function newClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe("useScopedAiDefaults", () => {
  beforeEach(() => vi.clearAllMocks());

  it("useScopedAiDefault fetches the platform default when no scope given", async () => {
    apiMock.get.mockResolvedValueOnce({ scopeNodeId: null });
    const queryClient = newClient();

    const { result } = renderHook(() => useScopedAiDefault(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiMock.get).toHaveBeenCalledWith("/harness/scoped-defaults");
  });

  it("useScopedAiDefault fetches the per-scope default", async () => {
    apiMock.get.mockResolvedValueOnce({ scopeNodeId: "scope-1" });
    const queryClient = newClient();

    const { result } = renderHook(() => useScopedAiDefault("scope-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiMock.get).toHaveBeenCalledWith(
      "/harness/scoped-defaults/scope-1",
    );
  });

  it("useSetScopedAiDefault puts and invalidates the scope detail query", async () => {
    apiMock.put.mockResolvedValueOnce({ scopeNodeId: "scope-1" });
    const queryClient = newClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSetScopedAiDefault(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        scopeNodeId: "scope-1",
        body: {
          harnessId: "claude-code",
          modelName: "m",
          providerName: "anthropic",
        },
      });
    });

    expect(apiMock.put).toHaveBeenCalledWith(
      "/harness/scoped-defaults/scope-1",
      {
        harnessId: "claude-code",
        modelName: "m",
        providerName: "anthropic",
      },
    );
    expect(invalidateSpy).toHaveBeenCalled();
  });
});
