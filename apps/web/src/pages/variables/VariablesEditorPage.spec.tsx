import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeProvider, useScopeContext } from "@/context/ScopeContext";
import { VariablesEditorPage } from "./VariablesEditorPage";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
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

describe("VariablesEditorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.get.mockResolvedValue([]);
  });

  it("renders the global variables list at the global scope", async () => {
    render(<VariablesEditorPage />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/variables \(global\)/i)).toBeInTheDocument();
    });

    expect(apiMock.get).toHaveBeenCalledWith("/variables", undefined);
  });

  describe("scope awareness", () => {
    it("sends the active scope node id to the variables list query", async () => {
      render(<VariablesEditorPage />, {
        wrapper: createWrapper(["/?scope=n1"]),
      });

      await waitFor(() => {
        expect(apiMock.get).toHaveBeenCalledWith("/variables", {
          params: { scopeId: "n1" },
        });
      });

      expect(
        await screen.findByText(/variables \(project\)/i),
      ).toBeInTheDocument();
    });

    it("refetches the variables list when the active scope changes", async () => {
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
            <VariablesEditorPage />
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
        expect(apiMock.get).toHaveBeenCalledWith("/variables", {
          params: { scopeId: "n1" },
        });
      });

      apiMock.get.mockClear();
      await user.click(screen.getByText("switch-scope"));

      await waitFor(() => {
        expect(screen.getByTestId("active-scope").textContent).toBe("n2");
        expect(apiMock.get).toHaveBeenCalledWith("/variables", {
          params: { scopeId: "n2" },
        });
      });
    });
  });
});
