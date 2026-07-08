import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";

async function invalidateLearningStatus(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.learning.status(),
  });
}

async function invalidateLearningCandidates(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: queryKeys.learning.candidates(),
  });
}

export function useLearningMemoryStatus() {
  return useQuery({
    queryKey: queryKeys.learning.status(),
    queryFn: () => api.getLearningMemoryStatus(),
    refetchInterval: 30_000,
  });
}

export function useRunLearningMemorySweep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.runLearningMemorySweep(),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningCandidates(queryClient),
      ]);
    },
  });
}

export function usePromoteLearningCandidate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { candidateId: string; requestedBy?: string }) =>
      api.promoteLearningCandidate({
        candidate_id: params.candidateId,
        requested_by: params.requestedBy,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningCandidates(queryClient),
      ]);
    },
  });
}

export function useRejectLearningCandidate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      candidateId: string;
      reason: string;
      rejectedBy?: string;
    }) =>
      api.rejectLearningCandidate(params.candidateId, {
        reason: params.reason,
        rejected_by: params.rejectedBy,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningCandidates(queryClient),
      ]);
    },
  });
}

export function useArchiveLearningCandidate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      candidateId: string;
      reason?: string;
      archivedBy?: string;
    }) =>
      api.archiveLearningCandidate(params.candidateId, {
        reason: params.reason,
        archived_by: params.archivedBy,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningCandidates(queryClient),
      ]);
    },
  });
}

export function useBulkRejectLearningCandidates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      candidateIds: string[];
      reason: string;
      rejectedBy?: string;
    }) =>
      api.bulkRejectLearningCandidates({
        candidate_ids: params.candidateIds,
        reason: params.reason,
        rejected_by: params.rejectedBy,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningCandidates(queryClient),
      ]);
    },
  });
}

export function useBulkArchiveLearningCandidates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      candidateIds: string[];
      reason?: string;
      archivedBy?: string;
    }) =>
      api.bulkArchiveLearningCandidates({
        candidate_ids: params.candidateIds,
        reason: params.reason,
        archived_by: params.archivedBy,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningCandidates(queryClient),
      ]);
    },
  });
}

export function useBulkPromoteLearningCandidates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { candidateIds: string[]; requestedBy?: string }) =>
      api.bulkPromoteLearningCandidates({
        candidate_ids: params.candidateIds,
        requested_by: params.requestedBy,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningCandidates(queryClient),
      ]);
    },
  });
}
