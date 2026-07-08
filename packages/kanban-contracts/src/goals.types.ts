import type { z } from "zod";

import type {
  CreateProjectGoalRequestSchema,
  CreateProjectGoalWorklogRequestSchema,
  LinkProjectGoalWorkItemRequestSchema,
  ProjectGoalMoscowSchema,
  ProjectGoalPrioritySchema,
  ProjectGoalSchema,
  ProjectGoalStatusSchema,
  ProjectGoalWorklogAuthorTypeSchema,
  ProjectGoalWorklogEntryTypeSchema,
  ProjectGoalWorklogSchema,
  ReorderProjectGoalsRequestSchema,
  UpdateProjectGoalRequestSchema,
  UpdateProjectGoalStatusRequestSchema,
} from "./goals.schema";

export type ProjectGoalStatus = z.infer<typeof ProjectGoalStatusSchema>;
export type ProjectGoalMoscow = z.infer<typeof ProjectGoalMoscowSchema>;
export type ProjectGoalPriority = z.infer<typeof ProjectGoalPrioritySchema>;
export type ProjectGoalWorklogEntryType = z.infer<
  typeof ProjectGoalWorklogEntryTypeSchema
>;
export type ProjectGoalWorklogAuthorType = z.infer<
  typeof ProjectGoalWorklogAuthorTypeSchema
>;
export type ProjectGoal = z.infer<typeof ProjectGoalSchema>;
export type ProjectGoalWorklog = z.infer<typeof ProjectGoalWorklogSchema>;
export type CreateProjectGoalRequest = z.infer<
  typeof CreateProjectGoalRequestSchema
>;
export type UpdateProjectGoalRequest = z.infer<
  typeof UpdateProjectGoalRequestSchema
>;
export type UpdateProjectGoalStatusRequest = z.infer<
  typeof UpdateProjectGoalStatusRequestSchema
>;
export type CreateProjectGoalWorklogRequest = z.infer<
  typeof CreateProjectGoalWorklogRequestSchema
>;
export type ReorderProjectGoalsRequest = z.infer<
  typeof ReorderProjectGoalsRequestSchema
>;
export type LinkProjectGoalWorkItemRequest = z.infer<
  typeof LinkProjectGoalWorkItemRequestSchema
>;
