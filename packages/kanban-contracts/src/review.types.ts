import type { z } from "zod";

import type { ProjectReviewDecisionInputSchema } from "./review.schema";

export type ProjectReviewDecisionInput = z.infer<
  typeof ProjectReviewDecisionInputSchema
>;
export type ReviewDecisionInput = ProjectReviewDecisionInput;
