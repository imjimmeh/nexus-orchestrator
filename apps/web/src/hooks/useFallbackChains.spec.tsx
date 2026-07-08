import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FallbackChain, FallbackChainEntry } from "@nexus/core";
import { queryKeys } from "@/lib/queryKeys";
import {
  useGlobalFallbackChain,
  useSetGlobalFallbackChain,
} from "./useFallbackChains";

const apiMock = vi.hoisted(() => ({
  getGlobalFallbackChain: vi.fn(),
  setGlobalFallbackChain: vi.fn(),
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
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

const sampleChain: FallbackChain = {
  name: "global",
  entries: [
    { provider_name: "anthropic", model_name: "claude-3-5-sonnet" },
    { provider_name: "openai", model_name: "gpt-4o" },
  ],
};

describe("useGlobalFallbackChain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches data using the fallbackChains.global query key", async () => {
    apiMock.getGlobalFallbackChain.mockResolvedValueOnce(sampleChain);

    const queryClient = newClient();
    const { result } = renderHook(() => useGlobalFallbackChain(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiMock.getGlobalFallbackChain).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(sampleChain);
  });

  it("uses the correct query key", () => {
    apiMock.getGlobalFallbackChain.mockResolvedValue(sampleChain);

    const queryClient = newClient();
    renderHook(() => useGlobalFallbackChain(), {
      wrapper: createWrapper(queryClient),
    });

    const cache = queryClient.getQueryCache().getAll();
    expect(cache.some((q) => q.queryKey[0] === "fallback-chains")).toBe(true);
    expect(
      cache.some(
        (q) =>
          JSON.stringify(q.queryKey) ===
          JSON.stringify(queryKeys.fallbackChains.global()),
      ),
    ).toBe(true);
  });
});

describe("useSetGlobalFallbackChain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls api.setGlobalFallbackChain with the provided entries", async () => {
    apiMock.setGlobalFallbackChain.mockResolvedValueOnce(sampleChain);

    const queryClient = newClient();
    const { result } = renderHook(() => useSetGlobalFallbackChain(), {
      wrapper: createWrapper(queryClient),
    });

    const newEntries: FallbackChainEntry[] = [
      { provider_name: "anthropic", model_name: "claude-opus-4" },
    ];

    await act(async () => {
      await result.current.mutateAsync(newEntries);
    });

    expect(apiMock.setGlobalFallbackChain).toHaveBeenCalledWith(newEntries);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("invalidates the fallbackChains.global query on success", async () => {
    apiMock.setGlobalFallbackChain.mockResolvedValueOnce(sampleChain);

    const queryClient = newClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSetGlobalFallbackChain(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync([
        { provider_name: "anthropic", model_name: "claude-3-5-sonnet" },
      ]);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.fallbackChains.global(),
    });
  });
});
