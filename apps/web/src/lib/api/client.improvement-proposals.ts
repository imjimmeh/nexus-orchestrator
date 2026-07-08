import type { CreateSkillAssignmentProposalRequest } from "@nexus/core";
import type { ApiResponse } from "./common.types";
import type { ApiClient } from "./client";
import type {
  ApiClientImprovementProposalsMethods,
  BulkImprovementProposalOutcome,
  CreateSkillAssignmentProposalOutcome,
  CreateSkillAssignmentProposalResult,
  ImprovementProposal,
  ListImprovementProposalsParams,
  ListImprovementProposalsResponse,
} from "./client.improvement-proposals.types";

export type {
  ApiClientImprovementProposalsMethods,
  BulkImprovementProposalOutcome,
  CreateSkillAssignmentProposalOutcome,
  CreateSkillAssignmentProposalResult,
  ImprovementProposal,
  ListImprovementProposalsParams,
  ListImprovementProposalsResponse,
};

function toListParams(
  params?: ListImprovementProposalsParams,
): Record<string, string> {
  const query: Record<string, string> = {};
  if (params?.kind && params.kind.length > 0) {
    query.kind = params.kind.join(",");
  }
  if (params?.status && params.status.length > 0) {
    query.status = params.status.join(",");
  }
  if (params?.page !== undefined) {
    query.page = String(params.page);
  }
  if (params?.limit !== undefined) {
    query.limit = String(params.limit);
  }
  return query;
}

export const improvementProposalsApiMethods: ApiClientImprovementProposalsMethods =
  {
    async listImprovementProposals(
      this: ApiClient,
      params?: ListImprovementProposalsParams,
    ): Promise<ListImprovementProposalsResponse> {
      const query = toListParams(params);
      return this.get<ListImprovementProposalsResponse>(
        "/improvement/proposals",
        { params: Object.keys(query).length > 0 ? query : undefined },
      );
    },

    /**
     * `POST /improvement/proposals` returns `{ success, outcome, data }` —
     * not the `{ success, data }` shape every sibling improvement-proposal
     * endpoint uses — so it can't go through the generic `ApiClient.post`
     * helper (which discards everything but `.data.data`). Call the
     * underlying axios client directly, as `getEventLedger` does for the
     * same reason.
     */
    async createSkillAssignmentProposal(
      this: ApiClient,
      body: CreateSkillAssignmentProposalRequest,
    ): Promise<CreateSkillAssignmentProposalResult> {
      const response = await this.client.post<
        ApiResponse<ImprovementProposal | null> & {
          outcome: CreateSkillAssignmentProposalOutcome;
        }
      >("/improvement/proposals", body);
      return {
        outcome: response.data.outcome,
        proposal: response.data.data,
      };
    },

    async approveImprovementProposal(
      this: ApiClient,
      id: string,
    ): Promise<ImprovementProposal> {
      return this.post<ImprovementProposal>(
        `/improvement/proposals/${id}/approve`,
      );
    },

    async rejectImprovementProposal(
      this: ApiClient,
      id: string,
    ): Promise<ImprovementProposal> {
      return this.post<ImprovementProposal>(
        `/improvement/proposals/${id}/reject`,
      );
    },

    async bulkApproveImprovementProposals(
      this: ApiClient,
      proposalIds: string[],
    ): Promise<BulkImprovementProposalOutcome[]> {
      return this.post<BulkImprovementProposalOutcome[]>(
        "/improvement/proposals/bulk-approve",
        { proposal_ids: proposalIds },
      );
    },

    async bulkRejectImprovementProposals(
      this: ApiClient,
      proposalIds: string[],
      reason?: string,
    ): Promise<BulkImprovementProposalOutcome[]> {
      return this.post<BulkImprovementProposalOutcome[]>(
        "/improvement/proposals/bulk-reject",
        { proposal_ids: proposalIds, reason },
      );
    },

    async rollbackImprovementProposal(
      this: ApiClient,
      id: string,
    ): Promise<ImprovementProposal> {
      return this.post<ImprovementProposal>(
        `/improvement/proposals/${id}/rollback`,
      );
    },
  };
