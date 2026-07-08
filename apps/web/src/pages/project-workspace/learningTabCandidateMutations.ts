import { useToast } from "@/hooks/useToast";
import type {
  useArchiveLearningCandidate,
  useBulkArchiveLearningCandidates,
  useBulkPromoteLearningCandidates,
  useBulkRejectLearningCandidates,
  usePromoteLearningCandidate,
  useRejectLearningCandidate,
} from "@/hooks/useLearningMemory";
import { BulkPromoteLearningCandidatesResult } from "@/lib/api/projects.types";
import { runToastedMutation } from "./learningTabMutationToasts";

export function rejectCandidate(
  mutation: ReturnType<typeof useRejectLearningCandidate>,
  toast: ReturnType<typeof useToast>,
  candidateId: string,
  reason: string,
): Promise<void> {
  return runToastedMutation(
    toast,
    () => mutation.mutateAsync({ candidateId, reason, rejectedBy: undefined }),
    {
      errorTitle: "Failed to reject candidate",
      errorFallback: "Unable to reject the candidate.",
      onSuccess: () =>
        toast.success(
          "Candidate rejected",
          "The learning candidate was rejected.",
        ),
    },
  );
}

export function archiveCandidate(
  mutation: ReturnType<typeof useArchiveLearningCandidate>,
  toast: ReturnType<typeof useToast>,
  candidateId: string,
): Promise<void> {
  return runToastedMutation(
    toast,
    () => mutation.mutateAsync({ candidateId }),
    {
      errorTitle: "Failed to archive candidate",
      errorFallback: "Unable to archive the candidate.",
      onSuccess: () =>
        toast.success(
          "Candidate archived",
          "The learning candidate was archived.",
        ),
    },
  );
}

export function bulkRejectCandidates(
  mutation: ReturnType<typeof useBulkRejectLearningCandidates>,
  toast: ReturnType<typeof useToast>,
  candidateIds: string[],
  reason: string,
): Promise<void> {
  return runToastedMutation(
    toast,
    () => mutation.mutateAsync({ candidateIds, reason }),
    {
      errorTitle: "Failed to reject candidates",
      errorFallback: "Unable to reject the selected candidates.",
      onSuccess: () =>
        toast.success(
          "Candidates rejected",
          `${candidateIds.length.toString()} candidate(s) rejected.`,
        ),
    },
  );
}

export function bulkArchiveCandidates(
  mutation: ReturnType<typeof useBulkArchiveLearningCandidates>,
  toast: ReturnType<typeof useToast>,
  candidateIds: string[],
): Promise<void> {
  return runToastedMutation(
    toast,
    () => mutation.mutateAsync({ candidateIds }),
    {
      errorTitle: "Failed to archive candidates",
      errorFallback: "Unable to archive the selected candidates.",
      onSuccess: () =>
        toast.success(
          "Candidates archived",
          `${candidateIds.length.toString()} candidate(s) archived.`,
        ),
    },
  );
}

export function promoteCandidate(
  mutation: ReturnType<typeof usePromoteLearningCandidate>,
  toast: ReturnType<typeof useToast>,
  candidateId: string,
): Promise<void> {
  return runToastedMutation(
    toast,
    () => mutation.mutateAsync({ candidateId }),
    {
      errorTitle: "Failed to promote candidate",
      errorFallback: "Unable to promote this candidate.",
      onSuccess: (result) =>
        toast.success(
          "Candidate promoted",
          result.memory_segment_id
            ? `Memory segment ${result.memory_segment_id} was created.`
            : "The candidate was promoted.",
        ),
    },
  );
}

function summarizeBulkPromoteResults(
  results: BulkPromoteLearningCandidatesResult[],
): { total: number; successCount: number; failureCount: number } {
  const failureCount = results.filter((result) => result.error).length;
  return {
    total: results.length,
    successCount: results.length - failureCount,
    failureCount,
  };
}

function reportBulkPromoteOutcome(
  toast: ReturnType<typeof useToast>,
  results: BulkPromoteLearningCandidatesResult[],
): void {
  const { total, successCount, failureCount } =
    summarizeBulkPromoteResults(results);

  if (failureCount === 0) {
    toast.success(
      "Candidates promoted",
      `Promoted ${successCount.toString()} of ${total.toString()} candidate(s).`,
    );
    return;
  }
  if (successCount === 0) {
    toast.error(
      "Promotion failed",
      `Failed to promote all ${total.toString()} candidate(s).`,
    );
    return;
  }
  toast.warning(
    "Candidates partially promoted",
    `Promoted ${successCount.toString()} of ${total.toString()} candidate(s); ${failureCount.toString()} failed.`,
  );
}

export function bulkPromoteCandidates(
  mutation: ReturnType<typeof useBulkPromoteLearningCandidates>,
  toast: ReturnType<typeof useToast>,
  candidateIds: string[],
): Promise<void> {
  return runToastedMutation(
    toast,
    () => mutation.mutateAsync({ candidateIds }),
    {
      errorTitle: "Promotion failed",
      errorFallback: "Unable to promote the selected candidates.",
      onSuccess: (results) => reportBulkPromoteOutcome(toast, results),
    },
  );
}
