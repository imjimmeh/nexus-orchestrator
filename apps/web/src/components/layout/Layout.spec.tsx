// apps/web/src/components/layout/Layout.spec.tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { Layout } from "./Layout";

vi.mock("@/stores/auth.store", () => ({
  useAuthStore: () => ({ user: { roles: ["admin"] } }),
}));

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderLayout(initialEntries?: string[]) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={initialEntries}>
        <Layout>
          <div data-testid="page-content">Page Content</div>
        </Layout>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Layout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders sidebar, header, and main content", () => {
    renderLayout();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: /main/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("page-content")).toBeInTheDocument();
  });

  it("does not render breadcrumbs on the home page", () => {
    renderLayout(["/"]);
    expect(
      screen.queryByRole("navigation", { name: /breadcrumb/i }),
    ).not.toBeInTheDocument();
  });

  it("renders breadcrumbs on nested routes", () => {
    renderLayout(["/workflows"]);
    expect(
      screen.getByRole("navigation", { name: /breadcrumb/i }),
    ).toBeInTheDocument();
  });
});
