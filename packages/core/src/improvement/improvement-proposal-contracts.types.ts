/**
 * Inferred TypeScript types for the improvement-proposal REST contracts.
 * Declared in a dedicated `*.types.ts` companion so the project's
 * `no-restricted-syntax` lint policy (exported type aliases live in
 * `*.types.ts` files) is satisfied; the schemas live in
 * `improvement-proposal-contracts.schema.ts`, the single source of truth.
 */
import type { z } from "zod";
import type {
  bulkApproveImprovementProposalsSchema,
  bulkRejectImprovementProposalsSchema,
  createSkillAssignmentProposalSchema,
  listImprovementProposalsSchema,
} from "./improvement-proposal-contracts.schema";

export type ListImprovementProposalsRequest = z.infer<
  typeof listImprovementProposalsSchema
>;
export type BulkApproveImprovementProposalsRequest = z.infer<
  typeof bulkApproveImprovementProposalsSchema
>;
export type BulkRejectImprovementProposalsRequest = z.infer<
  typeof bulkRejectImprovementProposalsSchema
>;
export type CreateSkillAssignmentProposalRequest = z.infer<
  typeof createSkillAssignmentProposalSchema
>;
