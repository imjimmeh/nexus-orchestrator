import { z } from "zod";
import {
  CreateAgentProfileSchema,
  UpdateAgentProfileSchema,
  AssignProfileSkillsSchema,
} from "./profiles.schema";

export type CreateAgentProfileRequest = z.infer<
  typeof CreateAgentProfileSchema
>;
export type UpdateAgentProfileRequest = z.infer<
  typeof UpdateAgentProfileSchema
>;
export type AssignProfileSkillsRequest = z.infer<
  typeof AssignProfileSkillsSchema
>;
