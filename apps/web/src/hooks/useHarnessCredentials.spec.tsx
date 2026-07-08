import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useBindCredential,
  useCredentialOAuthStatus,
  useCredentialRequirements,
  useStartCredentialOAuth,
  useSubmitCredentialOAuthCode,
  useUnbindCredential,
} from "./useHarnessCredentials";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

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

describe("useHarnessCredentials", () => {
  beforeEach(() => vi.clearAllMocks());

  it("useCredentialRequirements fetches requirements for a harness", async () => {
    apiMock.get.mockResolvedValueOnce({
      harnessId: "claude-code",
      requirements: [],
    });
    const queryClient = newClient();

    const { result } = renderHook(
      () => useCredentialRequirements("claude-code", "scope-1"),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiMock.get).toHaveBeenCalledWith(
      "/harness/claude-code/credentials",
      {
        params: { scopeNodeId: "scope-1" },
      },
    );
  });

  it("useBindCredential calls put and invalidates requirements", async () => {
    apiMock.put.mockResolvedValueOnce({ id: "binding-1" });
    const queryClient = newClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useBindCredential(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        harnessId: "claude-code",
        key: "anthropic",
        body: {
          authType: "api_key",
          secretId: "secret-1",
          scopeNodeId: "scope-1",
        },
      });
    });

    expect(apiMock.put).toHaveBeenCalledWith(
      "/harness/claude-code/credentials/anthropic",
      { authType: "api_key", secretId: "secret-1", scopeNodeId: "scope-1" },
    );
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("useUnbindCredential calls delete", async () => {
    apiMock.delete.mockResolvedValueOnce(undefined);
    const queryClient = newClient();

    const { result } = renderHook(() => useUnbindCredential(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        harnessId: "claude-code",
        key: "anthropic",
        scopeNodeId: "scope-1",
      });
    });

    expect(apiMock.delete).toHaveBeenCalledWith(
      "/harness/claude-code/credentials/anthropic?scopeNodeId=scope-1",
    );
  });

  it("useStartCredentialOAuth posts to the oauth start route", async () => {
    apiMock.post.mockResolvedValueOnce({
      sessionId: "sess-1",
      modality: "device",
      userCode: "ABCD",
      verificationUri: "https://example/device",
      intervalSeconds: 5,
      expiresAt: "2026-06-12T00:00:00.000Z",
    });
    const queryClient = newClient();

    const { result } = renderHook(() => useStartCredentialOAuth(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        harnessId: "claude-code",
        key: "anthropic",
        body: { scopeNodeId: "scope-1" },
      });
    });

    expect(apiMock.post).toHaveBeenCalledWith(
      "/harness/claude-code/credentials/anthropic/oauth/start",
      { scopeNodeId: "scope-1" },
    );
  });

  it("useSubmitCredentialOAuthCode posts to the submit-code route", async () => {
    apiMock.post.mockResolvedValueOnce({ accepted: true });
    const queryClient = newClient();

    const { result } = renderHook(() => useSubmitCredentialOAuthCode(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        harnessId: "claude-code",
        key: "anthropic",
        body: { session_id: "sess-1", code: "auth-code-123" },
      });
    });

    expect(apiMock.post).toHaveBeenCalledWith(
      "/harness/claude-code/credentials/anthropic/oauth/submit-code",
      { session_id: "sess-1", code: "auth-code-123" },
    );
  });

  it("useCredentialOAuthStatus polls the status endpoint while enabled", async () => {
    apiMock.get.mockResolvedValueOnce({ status: "pending" });
    const queryClient = newClient();

    const { result } = renderHook(
      () =>
        useCredentialOAuthStatus(
          { harnessId: "claude-code", key: "anthropic", sessionId: "sess-1" },
          { enabled: true },
        ),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiMock.get).toHaveBeenCalledWith(
      "/harness/claude-code/credentials/anthropic/oauth/session/sess-1",
    );
  });

  it("useCredentialOAuthStatus does not fetch when disabled", () => {
    const queryClient = newClient();

    renderHook(
      () =>
        useCredentialOAuthStatus(
          { harnessId: "claude-code", key: "anthropic", sessionId: "" },
          { enabled: false },
        ),
      { wrapper: createWrapper(queryClient) },
    );

    expect(apiMock.get).not.toHaveBeenCalled();
  });
});
