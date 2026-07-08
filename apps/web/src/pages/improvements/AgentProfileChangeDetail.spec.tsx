import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ImprovementProposal } from "@/lib/api/client.improvement-proposals.types";
import { AgentProfileChangeDetail } from "./AgentProfileChangeDetail";

vi.mock("@/lib/api/client", () => ({
  api: {
    listImprovementProposals: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    rollbackImprovementProposal: vi.fn().mockResolvedValue({}),
  },
}));

import { api } from "@/lib/api/client";

const mockApi = api as unknown as {
  listImprovementProposals: ReturnType<typeof vi.fn>;
  rollbackImprovementProposal: ReturnType<typeof vi.fn>;
};

function buildProposal(
  overrides: Partial<ImprovementProposal>,
): ImprovementProposal {
  return {
    id: "p1",
    kind: "agent_profile_change",
    status: "pending",
    payload: {},
    evidence: {},
    confidence: 0.6,
    rollback_data: null,
    occurrence_count: 1,
    provenance: {},
    applied_at: null,
    rolled_back_at: null,
    created_at: "2026-07-02T00:00:00Z",
    updated_at: "2026-07-02T00:00:00Z",
    ...overrides,
  };
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentProfileChangeDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.listImprovementProposals.mockResolvedValue({ data: [], total: 0 });
    mockApi.rollbackImprovementProposal.mockResolvedValue({});
  });

  it("renders the profile name, change summary and patch field-diff table for a pending proposal", () => {
    const proposal = buildProposal({
      status: "pending",
      payload: {
        profileName: "implement-agent",
        changeSummary: "Tighten the linter guidance.",
        patch: {
          system_prompt: { mode: "append", value: "Always run the linter." },
        },
      },
    });

    renderWithProviders(<AgentProfileChangeDetail proposal={proposal} />);

    expect(screen.getByText("implement-agent")).toBeInTheDocument();
    expect(
      screen.getByText("Tighten the linter guidance."),
    ).toBeInTheDocument();
    expect(screen.getByText("system_prompt (append)")).toBeInTheDocument();
    expect(screen.getByText("Always run the linter.")).toBeInTheDocument();
  });

  it("fills the From column from the rollback snapshot for an applied proposal", () => {
    const proposal = buildProposal({
      status: "applied",
      payload: {
        profileName: "implement-agent",
        changeSummary: "Swap the model.",
        patch: { model_name: "claude-sonnet-5" },
      },
      rollback_data: { model_name: "gpt-5" },
    });

    renderWithProviders(<AgentProfileChangeDetail proposal={proposal} />);

    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument();
  });

  it("shows a rollback button for an applied proposal and fires the rollback mutation on confirm", async () => {
    const proposal = buildProposal({
      id: "p-applied",
      status: "applied",
      payload: {
        profileName: "implement-agent",
        changeSummary: "Swap the model.",
        patch: { model_name: "claude-sonnet-5" },
      },
      rollback_data: { model_name: "gpt-5" },
    });

    renderWithProviders(<AgentProfileChangeDetail proposal={proposal} />);

    fireEvent.click(screen.getByRole("button", { name: /rollback/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm rollback/i }));

    await waitFor(() =>
      expect(mockApi.rollbackImprovementProposal).toHaveBeenCalledWith(
        "p-applied",
      ),
    );
  });

  it("does not show a rollback button for a pending proposal", () => {
    const proposal = buildProposal({
      status: "pending",
      payload: {
        profileName: "implement-agent",
        changeSummary: "Swap the model.",
        patch: { model_name: "claude-sonnet-5" },
      },
    });

    renderWithProviders(<AgentProfileChangeDetail proposal={proposal} />);

    expect(
      screen.queryByRole("button", { name: /rollback/i }),
    ).not.toBeInTheDocument();
  });
});
