import {
  AutomationHookActionType,
  AutomationHookTriggerType,
  ScheduledJobScope,
  ScheduledJobStatus,
  ScheduledJobType,
  StandingOrderOverridePolicy,
} from "../../interfaces";
import { z } from "zod";

export const createAutomationHookSchema = z.object({
  scopeId: z.uuid(),
  enabled: z.coerce.boolean().optional(),
  trigger_type: z.enum(AutomationHookTriggerType),
  trigger_filter: z.record(z.string(), z.unknown()).optional(),
  priority: z.coerce.number().int().min(0).max(10_000).optional(),
  action_type: z.enum(AutomationHookActionType),
  action_payload: z.record(z.string(), z.unknown()),
  cooldown_window_seconds: z.coerce
    .number()
    .int()
    .min(0)
    .max(86_400)
    .optional(),
  created_by: z.string().max(255).optional(),
});

export const updateAutomationHookSchema = z.object({
  enabled: z.coerce.boolean().optional(),
  trigger_type: z.enum(AutomationHookTriggerType).optional(),
  trigger_filter: z.record(z.string(), z.unknown()).optional(),
  priority: z.coerce.number().int().min(0).max(10_000).optional(),
  action_type: z.enum(AutomationHookActionType).optional(),
  action_payload: z.record(z.string(), z.unknown()).optional(),
  cooldown_window_seconds: z.coerce
    .number()
    .int()
    .min(0)
    .max(86_400)
    .optional(),
  updated_by: z.string().max(255).optional(),
});

export const listAutomationHooksSchema = z.object({
  scopeId: z.uuid().optional(),
  trigger_type: z.enum(AutomationHookTriggerType).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const createHeartbeatProfileSchema = z.object({
  scopeId: z.uuid(),
  name: z.string().max(180),
  enabled: z.coerce.boolean().optional(),
  interval_seconds: z.coerce.number().int().min(10).max(86_400),
  workflow_id: z.uuid(),
  payload_json: z.record(z.string(), z.unknown()).optional(),
  created_by: z.string().max(255).optional(),
});

export const updateHeartbeatProfileSchema = z.object({
  name: z.string().max(180).optional(),
  enabled: z.coerce.boolean().optional(),
  interval_seconds: z.coerce.number().int().min(10).max(86_400).optional(),
  workflow_id: z.uuid().optional(),
  payload_json: z.record(z.string(), z.unknown()).optional(),
  updated_by: z.string().max(255).optional(),
});

export const listHeartbeatProfilesSchema = z.object({
  scopeId: z.uuid(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const listHeartbeatRunsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const createScheduledJobSchema = z.object({
  schedule_scope: z.enum(ScheduledJobScope).optional(),
  scopeId: z.uuid().optional(),
  name: z.string().max(180),
  schedule_type: z.enum(ScheduledJobType),
  schedule_expression: z.string(),
  timezone: z.string().max(128).optional(),
  workflow_id: z.uuid(),
  payload_json: z.record(z.string(), z.unknown()).optional(),
  created_by: z.string().max(255).optional(),
});

export const updateScheduledJobSchema = z.object({
  name: z.string().max(180).optional(),
  schedule_type: z.enum(ScheduledJobType).optional(),
  schedule_expression: z.string().optional(),
  timezone: z.string().max(128).optional(),
  workflow_id: z.uuid().optional(),
  payload_json: z.record(z.string(), z.unknown()).optional(),
  updated_by: z.string().max(255).optional(),
});

export const listScheduledJobsSchema = z.object({
  scopeId: z.uuid().optional(),
  scope: z.enum(ScheduledJobScope).optional(),
  status: z.enum(ScheduledJobStatus).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const listScheduledJobRunsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const createStandingOrderSchema = z.object({
  scopeId: z.uuid(),
  title: z.string().max(180),
  instruction: z.string(),
  profile_name: z.string().max(120).optional(),
  enabled: z.coerce.boolean().optional(),
  priority: z.coerce.number().int().min(0).max(10_000).optional(),
  override_policy: z.enum(StandingOrderOverridePolicy).optional(),
  created_by: z.string().max(255).optional(),
});

export const updateStandingOrderSchema = z.object({
  title: z.string().max(180).optional(),
  instruction: z.string().optional(),
  profile_name: z.string().max(120).optional(),
  enabled: z.coerce.boolean().optional(),
  priority: z.coerce.number().int().min(0).max(10_000).optional(),
  override_policy: z.enum(StandingOrderOverridePolicy).optional(),
  updated_by: z.string().max(255).optional(),
});

export const listStandingOrdersSchema = z.object({
  scopeId: z.uuid(),
  profile_name: z.string().max(120).optional(),
  include_disabled: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type CreateAutomationHookRequest = z.infer<
  typeof createAutomationHookSchema
>;
export type UpdateAutomationHookRequest = z.infer<
  typeof updateAutomationHookSchema
>;
export type ListAutomationHooksRequest = z.infer<
  typeof listAutomationHooksSchema
>;
export type CreateHeartbeatProfileRequest = z.infer<
  typeof createHeartbeatProfileSchema
>;
export type UpdateHeartbeatProfileRequest = z.infer<
  typeof updateHeartbeatProfileSchema
>;
export type ListHeartbeatProfilesRequest = z.infer<
  typeof listHeartbeatProfilesSchema
>;
export type ListHeartbeatRunsRequest = z.infer<typeof listHeartbeatRunsSchema>;
export type CreateScheduledJobRequest = z.infer<
  typeof createScheduledJobSchema
>;
export type UpdateScheduledJobRequest = z.infer<
  typeof updateScheduledJobSchema
>;
export type ListScheduledJobsRequest = z.infer<typeof listScheduledJobsSchema>;
export type ListScheduledJobRunsRequest = z.infer<
  typeof listScheduledJobRunsSchema
>;
export type CreateStandingOrderRequest = z.infer<
  typeof createStandingOrderSchema
>;
export type UpdateStandingOrderRequest = z.infer<
  typeof updateStandingOrderSchema
>;
export type ListStandingOrdersRequest = z.infer<
  typeof listStandingOrdersSchema
>;
export type ScheduledJobScopeFilter = ScheduledJobScope;
