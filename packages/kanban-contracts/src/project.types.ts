import type { z } from "zod";

import type {
  CreateProjectInputSchema,
  CreateProjectRequestSchema,
  IngestionInputsSchema,
  ProjectGoalInputSchema,
  ProjectRecordSchema,
  ProjectSchema,
  ProjectSourceTypeSchema,
  UpdateProjectRequestSchema,
} from "./project.schema";

export type ProjectSourceType = z.infer<typeof ProjectSourceTypeSchema>;
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectGoalInput = z.infer<typeof ProjectGoalInputSchema>;
export type IngestionInputs = z.infer<typeof IngestionInputsSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;
