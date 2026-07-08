import { z } from "zod";
import {
  CreateAgentSkillSchema,
  UpdateAgentSkillSchema,
  UpsertSkillFileSchema,
  AgentSkillsQuerySchema,
  SkillScopeSchema,
} from "./skills.schema";

export type SkillScopeInput = z.infer<typeof SkillScopeSchema>;
export type CreateAgentSkillRequest = z.infer<typeof CreateAgentSkillSchema>;
export type UpdateAgentSkillRequest = z.infer<typeof UpdateAgentSkillSchema>;
export type UpsertSkillFileRequest = z.infer<typeof UpsertSkillFileSchema>;
export type AgentSkillsQuery = z.infer<typeof AgentSkillsQuerySchema>;
