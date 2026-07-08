import type { CreateSkillAssignmentProposalRequest } from "@nexus/core";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { CreateSkillAssignmentProposalResult, ImprovementProposal, ListImprovementProposalsParams } from "@/lib/api/client.improvement-proposals.types";
import type { ImprovementProposalFilters } from "./useImprovementProposals.types";

/**
 * Mutation hook for the operator-directed "Assign skill" flow (FU-10/PD-4).
 * Kept separate from `useImprovementProposals` (rather than folded into its
 * return value) so components that only need to create a proposal — e.g.
 * `AssignSkillDialog` — don't have to mount the full queue's list query.
 */
export function useCreateSkillAssignmentProposal() {
  const queryClient = useQueryClient();

  return useMutation<
    CreateSkillAssignmentProposalResult,
    Error,
    CreateSkillAssignmentProposalRequest
  >({
    mutationFn: (body: CreateSkillAssignmentProposalRequest) =>
      api.createSkillAssignmentProposal(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.improvementProposals.root(),
      });
    },
  });
}

/**
 * Data-fetching + mutation hook for the Improvements Queue page. Owns all
 * side effects (list query, filter state, approve/reject/bulk/rollback
 * mutations) so the page component stays presentation-only.
 */
export function useImprovementProposals() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ImprovementProposalFilters>({});

  const queryParams = useMemo<ListImprovementProposalsParams>(
    () => ({ kind: filters.kind, status: filters.status }),
    [filters.kind, filters.status],
  );

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.improvementProposals.all(queryParams),
    queryFn: () => api.listImprovementProposals(queryParams),
  });

  const invalidateProposals = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.improvementProposals.root(),
    });
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.approveImprovementProposal(id),
    onSuccess: invalidateProposals,
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.rejectImprovementProposal(id),
    onSuccess: invalidateProposals,
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (proposalIds: string[]) =>
      api.bulkApproveImprovementProposals(proposalIds),
    onSuccess: invalidateProposals,
  });

  const bulkRejectMutation = useMutation({
    mutationFn: ({
      proposalIds,
      reason,
    }: {
      proposalIds: string[];
      reason?: string;
    }) => api.bulkRejectImprovementProposals(proposalIds, reason),
    onSuccess: invalidateProposals,
  });

  const rollbackMutation = useMutation({
    mutationFn: (id: string) => api.rollbackImprovementProposal(id),
    onSuccess: invalidateProposals,
  });

  const proposals: ImprovementProposal[] = data?.data ?? [];

  return {
    proposals,
    total: data?.total ?? 0,
    isLoading,
    filters,
    setFilters,
    approve: (id: string) => approveMutation.mutateAsync(id),
    reject: (id: string) => rejectMutation.mutateAsync(id),
    bulkApprove: (proposalIds: string[]) =>
      bulkApproveMutation.mutateAsync(proposalIds),
    bulkReject: (proposalIds: string[], reason?: string) =>
      bulkRejectMutation.mutateAsync({ proposalIds, reason }),
    rollback: (id: string) => rollbackMutation.mutateAsync(id),
  };
}
