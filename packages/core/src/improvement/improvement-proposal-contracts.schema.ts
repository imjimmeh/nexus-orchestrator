import { z } from "zod";
import { csvToArray } from "../schemas/common/csv-to-array.helper";
import { assignmentTargetSchema } from "./assignment-target.schema";
import {
  IMPROVEMENT_PROPOSAL_KINDS,
  IMPROVEMENT_PROPOSAL_STATUSES,
} from "./improvement-proposal.types";

export const listImprovementProposalsSchema = z
  .object({
    kind: z.preprocess(
      csvToArray,
      z.array(z.enum(IMPROVEMENT_PROPOSAL_KINDS)).optional(),
    ),
    status: z.preprocess(
      csvToArray,
      z.array(z.enum(IMPROVEMENT_PROPOSAL_STATUSES)).optional(),
    ),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  })
  .strip();

export const bulkApproveImprovementProposalsSchema = z
  .object({
    proposal_ids: z.array(z.uuid()).min(1).max(100),
  })
  .strip();

export const bulkRejectImprovementProposalsSchema = z
  .object({
    proposal_ids: z.array(z.uuid()).min(1).max(100),
    reason: z.string().trim().min(1).optional(),
  })
  .strip();

/**
 * Body for `POST /improvement/proposals` — the browser-facing,
 * operator-directed "assign skill" flow (FU-10/PD-4). Creates a
 * `skill_assignment` improvement proposal; the server sets
 * `provenance.source` to mark it operator-directed (see
 * `ImprovementProposalsController.create`).
 */
export const createSkillAssignmentProposalSchema = z
  .object({
    skillName: z.string().trim().min(1).max(128),
    targets: z.array(assignmentTargetSchema).min(1),
    rationale: z.string().trim().min(1).max(2000).optional(),
  })
  .strip();
