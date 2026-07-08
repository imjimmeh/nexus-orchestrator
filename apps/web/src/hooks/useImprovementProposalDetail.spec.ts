import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImprovementProposal } from "@/lib/api/client.improvement-proposals.types";
import { Workflow } from "@/lib/api/workflows.types";
import { useWorkflowYamlForDiff } from "./useImprovementProposalDetail";

vi.mock("@/lib/api/client", () => ({
  api: {
    getWorkflow: vi.fn(),
  },
}));

import { api } from "@/lib/api/client";

const mockApi = api as unknown as { getWorkflow: ReturnType<typeof vi.fn> };

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

function buildWorkflow(overrides: Partial<Workflow>): Workflow {
  return {
    id: "wf-2",
    name: "some-workflow",
    yaml_definition: "fetched: yaml",
    is_active: true,
    created_at: "2026-07-02T00:00:00Z",
    updated_at: "2026-07-02T00:00:00Z",
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    children,
  );
}

describe("useWorkflowYamlForDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("short-circuits on rollback_data.yaml_definition without fetching the workflow", async () => {
    const proposal = buildProposal({
      rollback_data: { yaml_definition: "snapshot: yaml" },
      payload: { workflowId: "wf-1" },
    });

    const { result } = renderHook(() => useWorkflowYamlForDiff(proposal), {
      wrapper,
    });

    expect(result.current.originalYaml).toBe("snapshot: yaml");
    expect(result.current.isLoading).toBe(false);
    expect(mockApi.getWorkflow).not.toHaveBeenCalled();
  });

  it("fetches the workflow by payload.workflowId when no rollback snapshot exists", async () => {
    mockApi.getWorkflow.mockResolvedValue(buildWorkflow({}));
    const proposal = buildProposal({
      rollback_data: null,
      payload: { workflowId: "wf-2" },
    });

    const { result } = renderHook(() => useWorkflowYamlForDiff(proposal), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.originalYaml).toBe("fetched: yaml"),
    );
    expect(mockApi.getWorkflow).toHaveBeenCalledWith("wf-2");
  });

  it("returns undefined and fetches nothing when neither snapshot nor workflowId is available", () => {
    const proposal = buildProposal({
      rollback_data: null,
      payload: {},
    });

    const { result } = renderHook(() => useWorkflowYamlForDiff(proposal), {
      wrapper,
    });

    expect(result.current.originalYaml).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mockApi.getWorkflow).not.toHaveBeenCalled();
  });
});
