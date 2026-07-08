import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ImprovementProposal } from "@/lib/api/client.improvement-proposals.types";
import { WorkflowDefinitionChangeDetail } from "./WorkflowDefinitionChangeDetail";

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: (props: { original: string; modified: string }) => (
    <div
      data-testid="diff-editor"
      data-original={props.original}
      data-modified={props.modified}
    />
  ),
}));

vi.mock("@/hooks/useImprovementProposalDetail", () => ({
  useWorkflowYamlForDiff: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: {
    listImprovementProposals: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    rollbackImprovementProposal: vi.fn().mockResolvedValue({}),
  },
}));

import { api } from "@/lib/api/client";
import { useWorkflowYamlForDiff } from "@/hooks/useImprovementProposalDetail";

const mockApi = api as unknown as {
  listImprovementProposals: ReturnType<typeof vi.fn>;
  rollbackImprovementProposal: ReturnType<typeof vi.fn>;
};
const mockUseWorkflowYamlForDiff = useWorkflowYamlForDiff as ReturnType<
  typeof vi.fn
>;

function buildProposal(
  overrides: Partial<ImprovementProposal>,
): ImprovementProposal {
  return {
    id: "p1",
    kind: "workflow_definition_change",
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

describe("WorkflowDefinitionChangeDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.listImprovementProposals.mockResolvedValue({ data: [], total: 0 });
    mockApi.rollbackImprovementProposal.mockResolvedValue({});
    mockUseWorkflowYamlForDiff.mockReturnValue({
      originalYaml: undefined,
      isLoading: false,
    });
  });

  it("renders the target workflow name and the change summary table", () => {
    const proposal = buildProposal({
      payload: {
        workflowName: "implement_and_commit",
        proposedYaml: "steps: []",
        changeSummary: [
          {
            stepId: "implement",
            field: "retry_prompt",
            from: "",
            to: "Try again.",
            rationale: "Nudge agents that skip set_job_output.",
          },
        ],
      },
    });

    renderWithProviders(<WorkflowDefinitionChangeDetail proposal={proposal} />);

    expect(screen.getByText("implement_and_commit")).toBeInTheDocument();
    expect(screen.getByText("retry_prompt")).toBeInTheDocument();
    expect(screen.getByText("Try again.")).toBeInTheDocument();
    expect(
      screen.getByText("Nudge agents that skip set_job_output."),
    ).toBeInTheDocument();
  });

  it("renders a DiffEditor with the original and proposed YAML when a baseline is available", () => {
    mockUseWorkflowYamlForDiff.mockReturnValue({
      originalYaml: "steps: [old]",
      isLoading: false,
    });
    const proposal = buildProposal({
      payload: {
        workflowName: "implement_and_commit",
        proposedYaml: "steps: [new]",
        changeSummary: [
          { field: "steps", from: "old", to: "new", rationale: "because" },
        ],
      },
    });

    renderWithProviders(<WorkflowDefinitionChangeDetail proposal={proposal} />);

    const diffEditor = screen.getByTestId("diff-editor");
    expect(diffEditor).toHaveAttribute("data-original", "steps: [old]");
    expect(diffEditor).toHaveAttribute("data-modified", "steps: [new]");
  });

  it("falls back to a plain <pre> of the proposed YAML when no baseline is available", () => {
    mockUseWorkflowYamlForDiff.mockReturnValue({
      originalYaml: undefined,
      isLoading: false,
    });
    const proposal = buildProposal({
      payload: {
        workflowName: "implement_and_commit",
        proposedYaml: "steps: [new]",
        changeSummary: [
          { field: "steps", from: "old", to: "new", rationale: "because" },
        ],
      },
    });

    renderWithProviders(<WorkflowDefinitionChangeDetail proposal={proposal} />);

    expect(screen.queryByTestId("diff-editor")).not.toBeInTheDocument();
    expect(screen.getByText("steps: [new]")).toBeInTheDocument();
  });

  it("shows a rollback button for an applied proposal and fires the rollback mutation on confirm", async () => {
    const proposal = buildProposal({
      id: "p-applied",
      status: "applied",
      payload: {
        workflowName: "implement_and_commit",
        proposedYaml: "steps: [new]",
        changeSummary: [
          { field: "steps", from: "old", to: "new", rationale: "because" },
        ],
      },
    });

    renderWithProviders(<WorkflowDefinitionChangeDetail proposal={proposal} />);

    fireEvent.click(screen.getByRole("button", { name: /^rollback$/i }));
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
        workflowName: "implement_and_commit",
        proposedYaml: "steps: [new]",
        changeSummary: [
          { field: "steps", from: "old", to: "new", rationale: "because" },
        ],
      },
    });

    renderWithProviders(<WorkflowDefinitionChangeDetail proposal={proposal} />);

    expect(
      screen.queryByRole("button", { name: /^rollback$/i }),
    ).not.toBeInTheDocument();
  });
});
