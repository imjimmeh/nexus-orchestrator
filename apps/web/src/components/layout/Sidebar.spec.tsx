// apps/web/src/components/layout/Sidebar.spec.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeProvider } from "@/context/ScopeContext";
import { api } from "@/lib/api/client";
import { useNavSidebar } from "./useNavSidebar";
import { Sidebar } from "./Sidebar";
import { MobileNavProvider } from "./MobileNavContext";

vi.mock("@/stores/auth.store", () => ({
  useAuthStore: () => ({ user: { roles: ["admin"] } }),
}));

vi.mock("@/lib/api/client", () => ({
  api: { getMyPermissions: vi.fn() },
}));

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderSidebar(initialEntries?: string[]) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={initialEntries}>
        <ScopeProvider>
          <MobileNavProvider>
            <Sidebar />
          </MobileNavProvider>
        </ScopeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    useNavSidebar.setState({ isNavExpanded: true });
    vi.mocked(api.getMyPermissions).mockResolvedValue({
      permissions: [],
      scopeNodeId: "n1",
    });
  });

  it("renders navigation groups", () => {
    renderSidebar();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Automation")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Administration")).toBeInTheDocument();
  });

  it("renders group titles and item labels when expanded", () => {
    renderSidebar();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /collapse sidebar/i }),
    ).toBeInTheDocument();
  });

  it("collapses to the icon rail when toggled, hiding group titles", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(screen.queryByText("Work")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /expand sidebar/i }),
    ).toBeInTheDocument();
  });

  it("auto-rails when the scope panel is open, ignoring nav preference", () => {
    renderSidebar();
    // Confirm starts expanded
    expect(screen.getByText("Work")).toBeInTheDocument();
    // The globe button triggers the scope panel — click it
    fireEvent.click(screen.getByRole("button", { name: /scope tree/i }));
    // Nav should now be in rail mode (group titles hidden)
    expect(screen.queryByText("Work")).not.toBeInTheDocument();
  });

  it("highlights the active nav item", async () => {
    vi.mocked(api.getMyPermissions).mockResolvedValue({
      permissions: ["workflows:read"],
      scopeNodeId: "n1",
    });
    renderSidebar(["/workflows?scope=n1"]);
    // In wide mode the "Workflows" label is visible once permissions resolve
    // (Workflows is a workspace-plane, permission-gated item)
    expect(await screen.findByText("Workflows")).toBeInTheDocument();
    // The button containing "Workflows" should have the active class
    const workflowsButton = screen.getByRole("button", { name: /workflows/i });
    expect(workflowsButton.className).toContain("bg-primary/10");
  });

  it("hides Administration in the workspace plane (?scope=n1)", () => {
    renderSidebar(["/?scope=n1"]);
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
  });

  it("shows Administration at the global root (platform plane) for an admin", () => {
    renderSidebar();
    expect(screen.getByText("Administration")).toBeInTheDocument();
  });
});
