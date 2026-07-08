import { z } from "zod";

export const ProjectReviewDecisionInputSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    workflowId: z.string().min(1),
    requestedBy: z.string().optional(),
    feedback: z.string().optional(),
  })
  .strict();

export const ReviewDecisionInputSchema = ProjectReviewDecisionInputSchema;
