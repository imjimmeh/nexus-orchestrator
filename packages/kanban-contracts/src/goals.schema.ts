import { z } from "zod";

export const ProjectGoalStatusSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
]);

export const ProjectGoalMoscowSchema = z.enum([
  "must",
  "should",
  "could",
  "wont",
]);
export const ProjectGoalPrioritySchema = z.enum(["p0", "p1", "p2", "p3"]);

export const ProjectGoalWorklogEntryTypeSchema = z.enum([
  "note",
  "status_change",
  "agent_update",
  "system_event",
  "link",
]);

export const ProjectGoalWorklogAuthorTypeSchema = z.enum([
  "user",
  "agent",
  "system",
]);

export const ProjectGoalSchema = z
  .object({
    id: z.string().min(1),
    project_id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().nullable(),
    status: ProjectGoalStatusSchema,
    moscow: ProjectGoalMoscowSchema.nullable(),
    priority: ProjectGoalPrioritySchema.nullable(),
    sortOrder: z.number(),
    targetDate: z.string().nullable(),
    completedAt: z.string().nullable(),
    ownerAgentProfileId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    isArchived: z.boolean(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();

export const ProjectGoalWorklogSchema = z
  .object({
    id: z.string().min(1),
    goalId: z.string().min(1),
    project_id: z.string().min(1),
    workItemId: z.string().nullable(),
    entryType: ProjectGoalWorklogEntryTypeSchema,
    authorType: ProjectGoalWorklogAuthorTypeSchema,
    authorId: z.string().nullable(),
    authorName: z.string().nullable(),
    note: z.string(),
    linkedRunId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();

export const CreateProjectGoalRequestSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    status: ProjectGoalStatusSchema.optional(),
    moscow: ProjectGoalMoscowSchema.optional(),
    priority: ProjectGoalPrioritySchema.optional(),
    target_date: z.string().optional(),
  })
  .strict();

export const UpdateProjectGoalRequestSchema =
  CreateProjectGoalRequestSchema.partial();

export const UpdateProjectGoalStatusRequestSchema = z
  .object({
    status: ProjectGoalStatusSchema,
    note: z.string().optional(),
    author_type: ProjectGoalWorklogAuthorTypeSchema.optional(),
    author_id: z.string().optional(),
    author_name: z.string().optional(),
  })
  .strict();

export const CreateProjectGoalWorklogRequestSchema = z
  .object({
    entry_type: ProjectGoalWorklogEntryTypeSchema.optional(),
    author_type: ProjectGoalWorklogAuthorTypeSchema.optional(),
    author_id: z.string().optional(),
    author_name: z.string().optional(),
    note: z.string().min(1),
    work_item_id: z.string().optional(),
    linked_run_id: z.string().optional(),
  })
  .strict();

export const ReorderProjectGoalsRequestSchema = z
  .object({
    goal_ids: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const LinkProjectGoalWorkItemRequestSchema = z
  .object({
    work_item_id: z.string().min(1),
    author_id: z.string().optional(),
    author_name: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();
