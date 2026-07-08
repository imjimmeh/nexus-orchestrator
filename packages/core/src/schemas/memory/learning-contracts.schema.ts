import { z } from "zod";
import { csvToArray } from "../common/csv-to-array.helper";

export const LEARNING_CANDIDATE_STATUSES = [
  "pending",
  "promoted",
  "rejected",
  "archived",
] as const;

const opaqueScopeTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_.-]*$/);

const opaqueScopeIdSchema = z.string().trim().min(1).max(160);

export const learningScopeSchema = z
  .object({
    scope_type: opaqueScopeTypeSchema,
    scope_id: opaqueScopeIdSchema.nullable().optional(),
  })
  .superRefine((scope, context) => {
    if (scope.scope_type !== "global" && scope.scope_id == null) {
      context.addIssue({
        code: "custom",
        message: "scope_id is required unless scope_type is global",
        path: ["scope_id"],
      });
    }
  });

export const listLearningCandidatesSchema = z
  .object({
    status: z.preprocess(
      csvToArray,
      z.array(z.enum(LEARNING_CANDIDATE_STATUSES)).optional(),
    ),
    candidate_type: z.preprocess(
      csvToArray,
      z.array(z.string().trim().min(1).max(64)).optional(),
    ),
    scope_type: opaqueScopeTypeSchema.optional(),
    scope_id: opaqueScopeIdSchema.optional(),
    search: z.string().trim().min(1).max(200).optional(),
    min_score: z.coerce.number().min(0).max(1).optional(),
    created_from: z.coerce.date().optional(),
    created_to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    sortBy: z.string().trim().min(1).max(64).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  })
  .strip();

export const promoteLearningCandidateSchema = z
  .object({
    candidate_id: z.uuid(),
    requested_by: z.string().trim().min(1).max(128).optional(),
  })
  .strip();

export const rejectLearningCandidateSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000),
    rejected_by: z.string().trim().min(1).max(128).optional(),
  })
  .strip();

export const archiveLearningCandidateSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000).optional(),
    archived_by: z.string().trim().min(1).max(128).optional(),
  })
  .strip();

const bulkCandidateIdsSchema = z.array(z.uuid()).min(1).max(100);

export const bulkRejectLearningCandidatesSchema = z
  .object({
    candidate_ids: bulkCandidateIdsSchema,
    reason: z.string().trim().min(1).max(2000),
    rejected_by: z.string().trim().min(1).max(128).optional(),
  })
  .strip();

export const bulkArchiveLearningCandidatesSchema = z
  .object({
    candidate_ids: bulkCandidateIdsSchema,
    reason: z.string().trim().min(1).max(2000).optional(),
    archived_by: z.string().trim().min(1).max(128).optional(),
  })
  .strip();

export const bulkPromoteLearningCandidatesSchema = z
  .object({
    candidate_ids: bulkCandidateIdsSchema,
    requested_by: z.string().trim().min(1).max(128).optional(),
  })
  .strip();

export type LearningCandidateStatus =
  (typeof LEARNING_CANDIDATE_STATUSES)[number];
export type LearningScope = z.infer<typeof learningScopeSchema>;
export type ListLearningCandidatesRequest = z.infer<
  typeof listLearningCandidatesSchema
>;
export type PromoteLearningCandidateRequest = z.infer<
  typeof promoteLearningCandidateSchema
>;
export type RejectLearningCandidateRequest = z.infer<
  typeof rejectLearningCandidateSchema
>;
export type ArchiveLearningCandidateRequest = z.infer<
  typeof archiveLearningCandidateSchema
>;
export type BulkRejectLearningCandidatesRequest = z.infer<
  typeof bulkRejectLearningCandidatesSchema
>;
export type BulkArchiveLearningCandidatesRequest = z.infer<
  typeof bulkArchiveLearningCandidatesSchema
>;
export type BulkPromoteLearningCandidatesRequest = z.infer<
  typeof bulkPromoteLearningCandidatesSchema
>;
