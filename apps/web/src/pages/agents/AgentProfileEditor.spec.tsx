import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi } from "vitest";
import { ScopeProvider } from "@/context/ScopeContext";
import { AgentProfileEditor } from "./AgentProfileEditor";

vi.mock("@/hooks/useAgentProfiles", () => ({
  useAgentProfiles: () => ({ data: [], isLoading: false }),
  useCreateAgentProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAgentProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useAgentSkills", () => ({
  useAgentSkills: () => ({ data: [], isLoading: false }),
  useAgentProfileSkills: () => ({ data: [], isLoading: false }),
  useReplaceAgentProfileSkills: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/hooks/useProviders", () => ({
  useProviders: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/useModels", () => ({
  useModels: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/useTools", () => ({
  useTools: () => ({ data: [], isLoading: false }),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderEditor(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ScopeProvider>
          <Routes>
            <Route path="/agents/new" element={<AgentProfileEditor />} />
            <Route path="/agents/:id/edit" element={<AgentProfileEditor />} />
          </Routes>
        </ScopeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentProfileEditor", () => {
  it("shows create mode at /agents/new", () => {
    renderEditor("/agents/new");
    expect(screen.getByText("Create Agent Profile")).toBeTruthy();
  });

  it("shows edit mode at /agents/:id/edit", () => {
    renderEditor("/agents/agent-1/edit");
    expect(screen.getByText("Edit Agent Profile")).toBeTruthy();
  });

  it("renders all three tabs", () => {
    renderEditor("/agents/new");
    expect(screen.getByRole("tab", { name: /basic info/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /tools & skills/i })).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: /system & provenance/i }),
    ).toBeTruthy();
  });
});
