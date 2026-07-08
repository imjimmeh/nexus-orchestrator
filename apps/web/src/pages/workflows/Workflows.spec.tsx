import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeProvider, useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import { Workflows } from "./Workflows";

const mockWorkflowsPage = {
  data: [
    {
      id: "wf-1",
      name: "Deploy",
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      yaml_definition: "name: Deploy",
    },
  ],
  meta: { pagination: { total: 1, page: 1, limit: 20, totalPages: 1 } },
};

const apiMock = vi.hoisted(() => ({
  getWorkflowsPage: vi.fn(),
  deleteWorkflow: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({ api: apiMock }));

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

describe("Workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    apiMock.getWorkflowsPage.mockResolvedValue(mockWorkflowsPage);
  });

  it("renders the workflows table", async () => {
    render(<Workflows />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Deploy")).toBeTruthy();
    });
  });

  describe("scope awareness", () => {
    it("sends the global root scope id at the default (global) scope", async () => {
      render(<Workflows />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(apiMock.getWorkflowsPage).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: GLOBAL_SCOPE_NODE_ID }),
        );
      });
    });

    it("sends the active scope node id to the workflows list query", async () => {
      render(<Workflows />, { wrapper: createWrapper(["/?scope=n1"]) });

      await waitFor(() => {
        expect(apiMock.getWorkflowsPage).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n1" }),
        );
      });
    });

    it("refetches the workflows list when the active scope changes", async () => {
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
            <Workflows />
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
        expect(apiMock.getWorkflowsPage).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n1" }),
        );
      });

      apiMock.getWorkflowsPage.mockClear();
      await user.click(screen.getByText("switch-scope"));

      await waitFor(() => {
        expect(screen.getByTestId("active-scope").textContent).toBe("n2");
        expect(apiMock.getWorkflowsPage).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n2" }),
        );
      });
    });
  });
});
