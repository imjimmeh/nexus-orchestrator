// apps/web/src/pages/Users.spec.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Users } from "./Users";
import { usersApi } from "@/lib/api/users";
import { useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";

vi.mock("@/lib/api/users", () => ({
  usersApi: {
    getUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: () => true }),
}));

vi.mock("@/context/ScopeContext", () => ({
  useScopeContext: vi.fn(),
}));

vi.mock("@/components/scope/ScopeMembersPanel", () => ({
  ScopeMembersPanel: ({ scopeNodeId }: { scopeNodeId: string }) => (
    <div data-testid="scope-members-panel">panel:{scopeNodeId}</div>
  ),
}));

function renderUsers() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usersApi.getUsers).mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
    } as never);
  });

  it("renders the master user table at global scope", async () => {
    vi.mocked(useScopeContext).mockReturnValue({
      activeScopeNodeId: GLOBAL_SCOPE_NODE_ID,
      activeScopePath: ["Platform"],
      setActiveScopeNodeId: vi.fn(),
      setScopePath: vi.fn(),
      isScopePanelOpen: false,
      toggleScopePanel: vi.fn(),
    });

    renderUsers();

    await screen.findByRole("heading", { name: /users/i });
    expect(screen.queryByTestId("scope-members-panel")).toBeNull();
  });

  it("renders ScopeMembersPanel for the active scope at non-global scope", async () => {
    vi.mocked(useScopeContext).mockReturnValue({
      activeScopeNodeId: "scope-123",
      activeScopePath: ["Platform", "Acme", "Engineering"],
      setActiveScopeNodeId: vi.fn(),
      setScopePath: vi.fn(),
      isScopePanelOpen: false,
      toggleScopePanel: vi.fn(),
    });

    renderUsers();

    const panel = await screen.findByTestId("scope-members-panel");
    expect(panel.textContent).toBe("panel:scope-123");
    expect(screen.queryByRole("heading", { name: /^users$/i })).toBeNull();
  });

  it("does not fetch the master users table at non-global scope", async () => {
    vi.mocked(useScopeContext).mockReturnValue({
      activeScopeNodeId: "scope-123",
      activeScopePath: ["Platform", "Acme", "Engineering"],
      setActiveScopeNodeId: vi.fn(),
      setScopePath: vi.fn(),
      isScopePanelOpen: false,
      toggleScopePanel: vi.fn(),
    });

    renderUsers();

    await screen.findByTestId("scope-members-panel");
    expect(usersApi.getUsers).not.toHaveBeenCalled();
  });
});
