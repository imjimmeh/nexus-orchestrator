import type { ApiClient } from "./client";
import type { ApiClientProjectMethods } from "./client.projects.types";
import type {
  ArchiveLearningCandidateRequest,
  BulkArchiveLearningCandidatesRequest,
  BulkPromoteLearningCandidatesRequest,
  BulkPromoteLearningCandidatesResult,
  BulkRejectLearningCandidatesRequest,
  LearningCandidate,
  LearningCandidateListResponse,
  LearningSweepRunSummary,
  LearningSweepStatus,
  ListLearningCandidatesRequest,
  PromoteLearningCandidateRequest,
  PromoteLearningCandidateResponse,
  RejectLearningCandidateRequest,
} from "./projects.types";

type LearningProjectApiMethods = Pick<
  ApiClientProjectMethods,
  | "getLearningMemoryStatus"
  | "runLearningMemorySweep"
  | "getLearningCandidates"
  | "promoteLearningCandidate"
  | "rejectLearningCandidate"
  | "archiveLearningCandidate"
  | "bulkRejectLearningCandidates"
  | "bulkArchiveLearningCandidates"
  | "bulkPromoteLearningCandidates"
>;

function appendListParams(
  query: URLSearchParams,
  params: Record<string, string | number | string[] | undefined>,
): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      query.append(key, value.join(","));
      continue;
    }
    query.append(key, String(value));
  }
}

export const projectLearningApiMethods: LearningProjectApiMethods = {
  async getLearningMemoryStatus(this: ApiClient) {
    return this.get<LearningSweepStatus>("/memory/learning/status");
  },

  async runLearningMemorySweep(this: ApiClient) {
    return this.post<LearningSweepRunSummary>("/memory/learning/run", {});
  },

  async getLearningCandidates(
    this: ApiClient,
    params?: ListLearningCandidatesRequest,
  ) {
    const query = new URLSearchParams();
    appendListParams(query, {
      status: params?.status,
      candidate_type: params?.candidate_type,
      scope_type: params?.scope_type,
      scope_id: params?.scope_id,
      search: params?.search,
      min_score: params?.min_score,
      created_from: params?.created_from,
      created_to: params?.created_to,
      page: params?.page,
      limit: params?.limit,
      sortBy: params?.sortBy,
      sortDir: params?.sortDir,
    });

    const suffix = query.toString().length > 0 ? `?${query.toString()}` : "";
    return this.get<LearningCandidateListResponse>(
      `/memory/learning/candidates${suffix}`,
    );
  },

  async promoteLearningCandidate(
    this: ApiClient,
    data: PromoteLearningCandidateRequest,
  ) {
    return this.post<PromoteLearningCandidateResponse>(
      "/memory/learning/promote",
      data,
    );
  },

  async rejectLearningCandidate(
    this: ApiClient,
    candidateId: string,
    data: RejectLearningCandidateRequest,
  ) {
    return this.post<LearningCandidate>(
      `/memory/learning/candidates/${candidateId}/reject`,
      data,
    );
  },

  async archiveLearningCandidate(
    this: ApiClient,
    candidateId: string,
    data: ArchiveLearningCandidateRequest,
  ) {
    return this.post<LearningCandidate>(
      `/memory/learning/candidates/${candidateId}/archive`,
      data,
    );
  },

  async bulkRejectLearningCandidates(
    this: ApiClient,
    data: BulkRejectLearningCandidatesRequest,
  ) {
    return this.post<LearningCandidate[]>(
      "/memory/learning/candidates/bulk-reject",
      data,
    );
  },

  async bulkArchiveLearningCandidates(
    this: ApiClient,
    data: BulkArchiveLearningCandidatesRequest,
  ) {
    return this.post<LearningCandidate[]>(
      "/memory/learning/candidates/bulk-archive",
      data,
    );
  },

  async bulkPromoteLearningCandidates(
    this: ApiClient,
    data: BulkPromoteLearningCandidatesRequest,
  ) {
    return this.post<BulkPromoteLearningCandidatesResult[]>(
      "/memory/learning/candidates/bulk-promote",
      data,
    );
  },
};
