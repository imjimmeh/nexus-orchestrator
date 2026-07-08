import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { GlobalWorkItemsPage } from "./GlobalWorkItemsPage";
import { api } from "@/lib/api/client";

vi.mock("@/lib/api/client", () => ({
  api: {
    getAllWorkItems: vi.fn(),
    deleteWorkItem: vi.fn(),
  },
}));
vi.mock("@/hooks/useProjects", () => ({
  useProjectList: () => ({ data: [{ id: "p1", name: "Proj One" }] }),
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GlobalWorkItemsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("GlobalWorkItemsPage", () => {
  beforeEach(() => {
    vi.mocked(api.getAllWorkItems).mockResolvedValue({
      items: [
        {
          id: "wi-1",
          project_id: "p1",
          title: "Build login",
          status: "todo",
          type: "story",
          priority: "p2",
          dependsOn: [],
          blockers: [],
          updatedAt: "2026-01-02T00:00:00.000Z",
        } as never,
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
  });

  it("requests page data with the recency default sort", async () => {
    renderPage();
    await screen.findByText("Build login");
    const query = vi.mocked(api.getAllWorkItems).mock.calls[0][0];
    expect(query).toMatchObject({ sortBy: "updated_at", sortDir: "desc" });
  });

  it("renders the project name for a work item", async () => {
    renderPage();
    expect(await screen.findByText("Proj One")).toBeInTheDocument();
  });
});
