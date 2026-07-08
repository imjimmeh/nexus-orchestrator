import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeProvider, useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import { Secrets } from "./Secrets";

const mockSecrets = [
  {
    id: "sec-1",
    name: "Secret 1",
    metadata: {},
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
];

const apiMock = vi.hoisted(() => ({
  getSecrets: vi.fn(),
  getSecret: vi.fn(),
  createSecret: vi.fn(),
  updateSecret: vi.fn(),
  deleteSecret: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: apiMock,
}));

function createWrapper(initialEntries: string[] = ["/"]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <ScopeProvider>{children}</ScopeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The scope-switch test writes the active scope to localStorage, which
    // ScopeContext falls back to when no ?scope param is present; clear it so
    // the default-scope assertions genuinely start from the global root.
    localStorage.clear();
    apiMock.getSecrets.mockResolvedValue(mockSecrets);
  });

  it("renders the secrets table", async () => {
    render(<Secrets />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Secret 1")).toBeTruthy();
    });

    expect(screen.getByText("Secrets")).toBeTruthy();
  });

  describe("scope awareness", () => {
    it("sends the global root scope id at the default (global) scope", async () => {
      render(<Secrets />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(apiMock.getSecrets).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: GLOBAL_SCOPE_NODE_ID }),
        );
      });
    });

    it("sends the active scope node id to the secrets list query", async () => {
      render(<Secrets />, { wrapper: createWrapper(["/?scope=n1"]) });

      await waitFor(() => {
        expect(apiMock.getSecrets).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n1" }),
        );
      });
    });

    it("refetches the secrets list when the active scope changes", async () => {
      const user = userEvent.setup();
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });

      function Harness() {
        const { activeScopeNodeId, setActiveScopeNodeId } = useScopeContext();
        return (
          <>
            <button type="button" onClick={() => setActiveScopeNodeId("n2")}>
              switch-scope
            </button>
            <span data-testid="active-scope">{activeScopeNodeId}</span>
            <Secrets />
          </>
        );
      }

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/?scope=n1"]}>
            <ScopeProvider>
              <Harness />
            </ScopeProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(apiMock.getSecrets).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n1" }),
        );
      });

      apiMock.getSecrets.mockClear();
      await user.click(screen.getByText("switch-scope"));

      await waitFor(() => {
        expect(screen.getByTestId("active-scope").textContent).toBe("n2");
        expect(apiMock.getSecrets).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n2" }),
        );
      });
    });
  });
});
