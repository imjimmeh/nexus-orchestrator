import { z } from "zod";

export const KanbanSettingKeySchema = z.enum([
  "work_item_dispatch_max_active_per_project",
  "work_item_scheduler_enabled",
  "work_item_scheduler_scope_weight_large",
  "work_item_scheduler_scope_weight_standard",
  "work_item_preflight_pipeline_enabled",
  "work_item_preflight_required",
  "work_item_dispatch_polling_enabled",
  "work_item_dispatch_poll_interval_seconds",
  "work_item_dispatch_poll_batch_size",
  "orchestration_auto_restart_enabled",
  "orchestration_auto_restart_max_attempts",
  "orchestration_auto_restart_cooldown_seconds",
  "work_item_run_lease_enabled",
  "orchestration_wake_policy",
  "self_improvement_project_id",
]);

export const KanbanSettingSchema = z
  .object({
    key: KanbanSettingKeySchema,
    value: z.unknown(),
    description: z.string().nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const KanbanSettingsListResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(KanbanSettingSchema),
  })
  .strict();

export const KanbanSettingResponseSchema = z
  .object({
    success: z.literal(true),
    data: KanbanSettingSchema,
  })
  .strict();

export const UpdateKanbanSettingRequestSchema = z
  .object({
    value: z.unknown(),
    description: z.string().nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!("value" in data)) {
      ctx.addIssue({
        code: "custom",
        message: "value is required",
        path: ["value"],
      });
    }
  });
