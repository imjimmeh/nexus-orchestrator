import { z } from "zod";

export const doctorRepairHistoryStatuses = [
  "running",
  "succeeded",
  "partial",
  "failed",
] as const;

export const doctorReportFormats = ["machine", "human", "both"] as const;

export const doctorRepairActionIds = [
  "clear_stale_polling_markers",
  "requeue_recoverable_workflow_runs",
  "prune_orphaned_runtime_artifacts",
  "refresh_mcp_plugin_catalogs",
  "clean_git_worktrees",
  "recover_api_fetch_failures",
] as const;

export const listDoctorHistorySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  action_id: z.string().max(120).optional(),
  status: z.enum(doctorRepairHistoryStatuses).optional(),
});

export const getDoctorReportSchema = z.object({
  format: z.enum(doctorReportFormats).optional().default("both"),
});

export const executeDoctorRepairSchema = z.object({
  action_id: z.enum(doctorRepairActionIds),
  dry_run: z.coerce.boolean().optional().default(false),
  confirm: z.coerce.boolean().optional().default(false),
  arguments: z.record(z.string(), z.unknown()).optional().default({}),
  requested_by: z.string().max(255).optional(),
});

export type ListDoctorHistoryRequest = z.infer<typeof listDoctorHistorySchema>;

export type GetDoctorReportRequest = z.infer<typeof getDoctorReportSchema>;

export type ExecuteDoctorRepairRequest = z.infer<
  typeof executeDoctorRepairSchema
>;
