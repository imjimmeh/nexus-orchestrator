import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { act, createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api/client";
import { useCreateSkillAssignmentProposal } from "./useImprovementProposals";

vi.mock("@/lib/api/client", () => ({
  api: {
    createSkillAssignmentProposal: vi.fn(),
  },
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe("useCreateSkillAssignmentProposal", () => {
  it("invalidates the improvement proposals list on a successful create", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    vi.mocked(api.createSkillAssignmentProposal).mockResolvedValueOnce({
      outcome: "auto_applied",
      proposal: null,
    });

    const { result } = renderHook(() => useCreateSkillAssignmentProposal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        skillName: "some-skill",
        targets: [{ type: "agent_profile", profileName: "merge-agent" }],
      });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["improvementProposals"] }),
      );
    });
  });

  it("does not invalidate the list when the create call fails", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    vi.mocked(api.createSkillAssignmentProposal).mockRejectedValueOnce(
      new Error("boom"),
    );

    const { result } = renderHook(() => useCreateSkillAssignmentProposal(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current
        .mutateAsync({
          skillName: "some-skill",
          targets: [{ type: "agent_profile", profileName: "merge-agent" }],
        })
        .catch(() => undefined);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
