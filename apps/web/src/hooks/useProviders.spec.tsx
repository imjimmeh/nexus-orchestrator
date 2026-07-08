import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { ProviderOAuthStatus } from "@/lib/api/common.types";
import {
  useCompleteProviderOAuthCallback,
  useInitiateProviderOAuth,
  useProviderOAuthStatus,
} from "./useProviders";

const apiMock = vi.hoisted(() => ({
  getProviders: vi.fn(),
  getProvider: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  getProviderOAuthStatus: vi.fn(),
  initiateProviderOAuth: vi.fn(),
  completeProviderOAuthCallback: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: apiMock,
}));

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useProviderOAuthStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls api.getProviderOAuthStatus with the provider id", async () => {
    const status: ProviderOAuthStatus = { status: "connected" };
    apiMock.getProviderOAuthStatus.mockResolvedValueOnce(status);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const { result } = renderHook(() => useProviderOAuthStatus("provider-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiMock.getProviderOAuthStatus).toHaveBeenCalledWith("provider-1");
    expect(result.current.data).toEqual(status);
  });

  it("does not fetch when provider id is empty", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    renderHook(() => useProviderOAuthStatus(""), {
      wrapper: createWrapper(queryClient),
    });

    expect(apiMock.getProviderOAuthStatus).not.toHaveBeenCalled();
  });
});

describe("useInitiateProviderOAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls api.initiateProviderOAuth and invalidates provider queries on success", async () => {
    const authResponse = {
      authorizationUrl: "https://provider.example/oauth/authorize",
      state: "state-123",
    };
    apiMock.initiateProviderOAuth.mockResolvedValueOnce(authResponse);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useInitiateProviderOAuth(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        providerId: "provider-1",
        data: { redirect_uri: "http://localhost:3120/callback" },
      });
    });

    expect(apiMock.initiateProviderOAuth).toHaveBeenCalledWith("provider-1", {
      redirect_uri: "http://localhost:3120/callback",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.adminResources.providers.all(),
    });
  });
});

describe("useCompleteProviderOAuthCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls api.completeProviderOAuthCallback and invalidates provider queries and status on success", async () => {
    const status: ProviderOAuthStatus = { status: "connected" };
    apiMock.completeProviderOAuthCallback.mockResolvedValueOnce(status);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCompleteProviderOAuthCallback(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        code: "auth-code-123",
        state: "state-123",
      });
    });

    expect(apiMock.completeProviderOAuthCallback).toHaveBeenCalledWith({
      code: "auth-code-123",
      state: "state-123",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.adminResources.providers.all(),
    });
  });
});
