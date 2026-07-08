import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeProvider, useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import { AgentProfiles } from "./AgentProfiles";

const mockProfiles = [
  {
    id: "profile-1",
    name: "Reviewer",
    system_prompt: "Review code",
    model_name: "gpt-5",
    provider_name: "openai",
    tier_preference: "heavy",
    is_active: true,
    source: "admin",
    created_by_profile: null,
    created_by_workflow_run_id: null,
  },
];

const apiMock = vi.hoisted(() => ({
  getAgentProfiles: vi.fn(),
  deleteAgentProfile: vi.fn(),
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

describe("AgentProfiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    apiMock.getAgentProfiles.mockResolvedValue(mockProfiles);
  });

  it("renders the agent profiles table", async () => {
    render(<AgentProfiles />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Reviewer")).toBeTruthy();
    });
  });

  describe("scope awareness", () => {
    it("sends the global root scope id at the default (global) scope", async () => {
      render(<AgentProfiles />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(apiMock.getAgentProfiles).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: GLOBAL_SCOPE_NODE_ID }),
        );
      });
    });

    it("sends the active scope node id to the agent profiles list query", async () => {
      render(<AgentProfiles />, { wrapper: createWrapper(["/?scope=n1"]) });

      await waitFor(() => {
        expect(apiMock.getAgentProfiles).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n1" }),
        );
      });
    });

    it("refetches the agent profiles list when the active scope changes", async () => {
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
            <AgentProfiles />
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
        expect(apiMock.getAgentProfiles).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n1" }),
        );
      });

      apiMock.getAgentProfiles.mockClear();
      await user.click(screen.getByText("switch-scope"));

      await waitFor(() => {
        expect(screen.getByTestId("active-scope").textContent).toBe("n2");
        expect(apiMock.getAgentProfiles).toHaveBeenCalledWith(
          expect.objectContaining({ scopeNodeId: "n2" }),
        );
      });
    });
  });
});
