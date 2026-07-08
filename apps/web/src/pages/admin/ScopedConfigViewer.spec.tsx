import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { ScopeProvider } from "@/context/ScopeContext";
import { ScopedConfigViewer } from "./ScopedConfigViewer";

vi.mock("@/hooks/useScopedConfig", () => ({
  useResolvedAgentProfile: vi
    .fn()
    .mockReturnValue({ data: null, isLoading: false, isError: false }),
  useResolvedWorkflow: vi
    .fn()
    .mockReturnValue({ data: null, isLoading: false, isError: false }),
  useForkAgentForScope: vi
    .fn()
    .mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useForkWorkflowForScope: vi
    .fn()
    .mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useAgentProfiles", () => ({
  useAgentProfiles: vi.fn().mockReturnValue({ data: [] }),
}));
vi.mock("@/hooks/useWorkflows", () => ({
  useWorkflows: vi.fn().mockReturnValue({ data: { data: [] } }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(ScopeProvider, null, children),
    ),
  );
}

describe("ScopedConfigViewer", () => {
  it("renders without crashing", () => {
    render(React.createElement(ScopedConfigViewer), { wrapper });
    expect(screen.getByText(/scoped config/i)).toBeTruthy();
  });

  it("shows object type selector", () => {
    render(React.createElement(ScopedConfigViewer), { wrapper });
    expect(screen.getByLabelText(/object type/i)).toBeTruthy();
  });
});
