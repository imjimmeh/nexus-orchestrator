import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeProvider, useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import { BudgetPoliciesTab } from "./BudgetPoliciesTab";

const apiMock = vi.hoisted(() => ({
  fetchPolicies: vi.fn(),
  createPolicy: vi.fn(),
  updatePolicy: vi.fn(),
  disablePolicy: vi.fn(),
  getProviders: vi.fn(),
  getModels: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({ api: apiMock }));

function createWrapper(initialEntries: string[] = ["/"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <ScopeProvider>{children}</ScopeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("BudgetPoliciesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    apiMock.fetchPolicies.mockResolvedValue([]);
    apiMock.getProviders.mockResolvedValue([]);
    apiMock.getModels.mockResolvedValue([]);
  });

  it("renders the add-policy action and empty state", async () => {
    render(<BudgetPoliciesTab />, { wrapper: createWrapper() });

    expect(screen.getByRole("button", { name: /Add Policy/i })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("No budget policies found")).toBeTruthy();
    });
  });

  describe("scope awareness", () => {
    it("sends the global root scope id at the default (global) scope", async () => {
      render(<BudgetPoliciesTab />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(apiMock.fetchPolicies).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: GLOBAL_SCOPE_NODE_ID }),
        );
      });
    });

    it("sends the active scope node id to the budget policies list query", async () => {
      render(<BudgetPoliciesTab />, { wrapper: createWrapper(["/?scope=n1"]) });

      await waitFor(() => {
        expect(apiMock.fetchPolicies).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n1" }),
        );
      });
    });

    it("refetches the budget policies list when the active scope changes", async () => {
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
            <BudgetPoliciesTab />
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
        expect(apiMock.fetchPolicies).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n1" }),
        );
      });

      apiMock.fetchPolicies.mockClear();
      await user.click(screen.getByText("switch-scope"));

      await waitFor(() => {
        expect(screen.getByTestId("active-scope").textContent).toBe("n2");
        expect(apiMock.fetchPolicies).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n2" }),
        );
      });
    });
  });
});
