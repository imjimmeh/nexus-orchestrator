import type { z } from "zod";
import type {
  BudgetPolicyResponseSchema,
  BudgetQuerySchema,
  BudgetSummaryRowSchema,
  BudgetSummarySchema,
  BudgetTimelineRowSchema,
  BudgetUsageEventResponseSchema,
  CreateBudgetPolicySchema,
  EvaluateActionSchema,
  RecordUsageEventSchema,
  UpdateBudgetPolicySchema,
} from "./cost-governance.schema";

export type BudgetPolicy = z.infer<typeof BudgetPolicyResponseSchema>;
export type CreateBudgetPolicyRequest = z.infer<
  typeof CreateBudgetPolicySchema
>;
export type UpdateBudgetPolicyRequest = z.infer<
  typeof UpdateBudgetPolicySchema
>;
export type EvaluateActionRequest = z.infer<typeof EvaluateActionSchema>;
export type RecordUsageEventRequest = z.infer<typeof RecordUsageEventSchema>;
export type BudgetQueryParams = z.infer<typeof BudgetQuerySchema>;
export type BudgetSummaryParams = z.infer<typeof BudgetSummarySchema>;
export type BudgetSummaryRow = z.infer<typeof BudgetSummaryRowSchema>;
export type BudgetTimelineRow = z.infer<typeof BudgetTimelineRowSchema>;
export type BudgetUsageEventResponse = z.infer<
  typeof BudgetUsageEventResponseSchema
>;
