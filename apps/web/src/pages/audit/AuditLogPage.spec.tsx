import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeProvider, useScopeContext } from "@/context/ScopeContext";
import { AuditLogPage } from "./AuditLogPage";

const apiMock = vi.hoisted(() => ({
  getAuditLog: vi.fn(),
  getScopeTree: vi.fn(),
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

describe("AuditLogPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getAuditLog.mockResolvedValue({ entries: [], total: 0 });
    apiMock.getScopeTree.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000000",
      name: "Platform",
      children: [],
    });
  });

  it("queries the full accessible set at the global scope", async () => {
    render(<AuditLogPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(apiMock.getAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ scopeNodeId: undefined }),
      );
    });
  });

  describe("scope awareness", () => {
    it("sends the active scope node id to the audit log query", async () => {
      render(<AuditLogPage />, { wrapper: createWrapper(["/?scope=n1"]) });

      await waitFor(() => {
        expect(apiMock.getAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n1" }),
        );
      });
    });

    it("refetches the audit log when the active scope changes", async () => {
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
            <AuditLogPage />
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
        expect(apiMock.getAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n1" }),
        );
      });

      apiMock.getAuditLog.mockClear();
      await user.click(screen.getByText("switch-scope"));

      await waitFor(() => {
        expect(screen.getByTestId("active-scope").textContent).toBe("n2");
        expect(apiMock.getAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n2" }),
        );
      });
    });
  });
});
