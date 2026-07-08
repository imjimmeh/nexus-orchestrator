import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderOAuthStatus } from "@/lib/api/common.types";
import { ProviderOAuthCallback } from "./ProviderOAuthCallback";

const connectedStatus: ProviderOAuthStatus = { status: "connected" };

const apiMock = vi.hoisted(() => ({
  completeProviderOAuthCallback: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: apiMock,
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createWrapper(initialRoute: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/providers/oauth/callback" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ProviderOAuthCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state when code and state are present", async () => {
    const deferred = createDeferred<ProviderOAuthStatus>();
    apiMock.completeProviderOAuthCallback.mockReturnValue(deferred.promise);

    render(<ProviderOAuthCallback />, {
      wrapper: createWrapper(
        "/providers/oauth/callback?code=abc123&state=12345678901234567890123456789012",
      ),
    });

    expect(screen.getByText("Completing OAuth authorization...")).toBeTruthy();

    deferred.resolve(connectedStatus);
    await waitFor(() => {
      expect(screen.getByText("OAuth Connected Successfully")).toBeTruthy();
    });
  });

  it("shows error state when code is missing", () => {
    render(<ProviderOAuthCallback />, {
      wrapper: createWrapper("/providers/oauth/callback"),
    });

    expect(screen.getByText("Invalid Request")).toBeTruthy();
    expect(screen.getByText(/missing authorization parameters/i)).toBeTruthy();
  });

  it("shows success state after successful callback", async () => {
    apiMock.completeProviderOAuthCallback.mockResolvedValueOnce(
      connectedStatus,
    );

    render(<ProviderOAuthCallback />, {
      wrapper: createWrapper(
        "/providers/oauth/callback?code=abc123&state=12345678901234567890123456789012",
      ),
    });

    await waitFor(() => {
      expect(screen.getByText("OAuth Connected Successfully")).toBeTruthy();
    });
  });

  it("provides a link back to providers page", async () => {
    apiMock.completeProviderOAuthCallback.mockResolvedValueOnce(
      connectedStatus,
    );

    render(<ProviderOAuthCallback />, {
      wrapper: createWrapper(
        "/providers/oauth/callback?code=abc123&state=12345678901234567890123456789012",
      ),
    });

    await waitFor(() => {
      const backLink = screen.getByRole("link", { name: /back to providers/i });
      expect(backLink).toBeTruthy();
    });
  });

  it("shows the specific error message from the mutation", async () => {
    const deferred = createDeferred<ProviderOAuthStatus>();
    apiMock.completeProviderOAuthCallback.mockReturnValue(deferred.promise);

    render(<ProviderOAuthCallback />, {
      wrapper: createWrapper(
        "/providers/oauth/callback?code=abc123&state=12345678901234567890123456789012",
      ),
    });

    deferred.reject(new Error("Session owner does not match provider owner"));
    await waitFor(() => {
      expect(
        screen.getByText("Session owner does not match provider owner"),
      ).toBeTruthy();
    });
  });

  it("submits exactly once for a given code/state pair", async () => {
    apiMock.completeProviderOAuthCallback.mockResolvedValueOnce(
      connectedStatus,
    );

    render(<ProviderOAuthCallback />, {
      wrapper: createWrapper(
        "/providers/oauth/callback?code=abc123&state=12345678901234567890123456789012",
      ),
    });

    await waitFor(() => {
      expect(screen.getByText("OAuth Connected Successfully")).toBeTruthy();
    });

    expect(apiMock.completeProviderOAuthCallback).toHaveBeenCalledTimes(1);
  });
});
