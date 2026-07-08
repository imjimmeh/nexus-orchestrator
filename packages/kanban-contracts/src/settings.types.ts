import type { z } from "zod";
import type {
  KanbanSettingKeySchema,
  KanbanSettingResponseSchema,
  KanbanSettingSchema,
  KanbanSettingsListResponseSchema,
  UpdateKanbanSettingRequestSchema,
} from "./settings.schema";

export type KanbanSettingKey = z.infer<typeof KanbanSettingKeySchema>;
export type KanbanSetting = z.infer<typeof KanbanSettingSchema>;
export type KanbanSettingsListResponse = z.infer<
  typeof KanbanSettingsListResponseSchema
>;
export type KanbanSettingResponse = z.infer<typeof KanbanSettingResponseSchema>;
export type UpdateKanbanSettingRequest = z.infer<
  typeof UpdateKanbanSettingRequestSchema
>;
