// apps/web/src/components/scope/ScopeTree.spec.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScopeTree } from "./ScopeTree";
import { ScopeProvider } from "@/context/ScopeContext";
import { api } from "@/lib/api/client";
import type { ScopeNode } from "@/lib/api/client.scope.types";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";

vi.mock("@/lib/api/client", () => ({ api: { getScopeTree: vi.fn() } }));

const mockTree: ScopeNode = {
  id: GLOBAL_SCOPE_NODE_ID,
  parentId: null,
  type: "platform",
  name: "Platform",
  slug: "platform",
  metadata: {},
  createdAt: "",
  updatedAt: "",
  children: [
    {
      id: "org-1",
      parentId: GLOBAL_SCOPE_NODE_ID,
      type: "org",
      name: "Acme Corp",
      slug: "acme",
      metadata: {},
      createdAt: "",
      updatedAt: "",
      children: [],
    },
  ],
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ScopeProvider>{children}</ScopeProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("ScopeTree", () => {
  it("renders loading state", () => {
    vi.mocked(api.getScopeTree).mockReturnValue(new Promise(() => {}));
    render(<ScopeTree />, { wrapper });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders scope nodes after load", async () => {
    vi.mocked(api.getScopeTree).mockResolvedValue(mockTree);
    render(<ScopeTree />, { wrapper });
    expect(await screen.findByText("Platform")).toBeInTheDocument();
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
  });

  it("filters nodes by search text", async () => {
    vi.mocked(api.getScopeTree).mockResolvedValue(mockTree);
    render(<ScopeTree />, { wrapper });
    await screen.findByText("Acme Corp");
    fireEvent.change(screen.getByPlaceholderText(/filter/i), {
      target: { value: "Acme" },
    });
    expect(screen.queryByText("Platform")).not.toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });
});
