import type {
  CreateSkillAssignmentProposalRequest,
  ImprovementProposalKind,
  ImprovementProposalStatus,
} from "@nexus/core";
import type { Timestamps } from "./common.types";
import type { ApiClient } from "./client";

export interface ListImprovementProposalsParams {
  kind?: ImprovementProposalKind[];
  status?: ImprovementProposalStatus[];
  page?: number;
  limit?: number;
}

export interface ListImprovementProposalsResponse {
  data: ImprovementProposal[];
  total: number;
}

export interface BulkImprovementProposalOutcome {
  id: string;
  status: "approved" | "rejected" | "failed";
  proposal: ImprovementProposal | null;
  error?: string;
}

export interface ImprovementProposal extends Timestamps {
  id: string;
  kind: ImprovementProposalKind;
  status: ImprovementProposalStatus;
  payload: Record<string, unknown>;
  evidence: Record<string, unknown>;
  confidence: number;
  rollback_data?: Record<string, unknown> | null;
  occurrence_count: number;
  provenance: Record<string, unknown>;
  applied_at?: string | null;
  rolled_back_at?: string | null;
}

/**
 * Mirrors `SubmitProposalResult['outcome']`
 * (`apps/api/src/improvement/improvement-proposal.service.types.ts`) — the
 * governance decision made at proposal-creation time, not just whether the
 * HTTP call succeeded.
 */
export type CreateSkillAssignmentProposalOutcome =
  | "auto_applied"
  | "proposed"
  | "dropped"
  | "apply_failed";

/**
 * Response shape for `POST /improvement/proposals`. The route's envelope is
 * `{ success, outcome, data }` — distinct from every sibling improvement-
 * proposal endpoint's plain `{ success, data }` — because the caller needs
 * to know the governance outcome, not just the created row.
 */
export interface CreateSkillAssignmentProposalResult {
  outcome: CreateSkillAssignmentProposalOutcome;
  proposal: ImprovementProposal | null;
}

export interface ApiClientImprovementProposalsMethods {
  listImprovementProposals(
    this: ApiClient,
    params?: ListImprovementProposalsParams,
  ): Promise<ListImprovementProposalsResponse>;
  createSkillAssignmentProposal(
    this: ApiClient,
    body: CreateSkillAssignmentProposalRequest,
  ): Promise<CreateSkillAssignmentProposalResult>;
  approveImprovementProposal(
    this: ApiClient,
    id: string,
  ): Promise<ImprovementProposal>;
  rejectImprovementProposal(
    this: ApiClient,
    id: string,
  ): Promise<ImprovementProposal>;
  bulkApproveImprovementProposals(
    this: ApiClient,
    proposalIds: string[],
  ): Promise<BulkImprovementProposalOutcome[]>;
  bulkRejectImprovementProposals(
    this: ApiClient,
    proposalIds: string[],
    reason?: string,
  ): Promise<BulkImprovementProposalOutcome[]>;
  rollbackImprovementProposal(
    this: ApiClient,
    id: string,
  ): Promise<ImprovementProposal>;
}
