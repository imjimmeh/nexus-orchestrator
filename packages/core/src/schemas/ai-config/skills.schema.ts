import { z } from "zod";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SkillScopeSchema = z.object({
  projects: z.array(z.string().min(1)).optional(),
  agents: z.array(z.string().min(1)).optional(),
  workflows: z.array(z.string().min(1)).optional(),
});

export const CreateAgentSkillSchema = z.object({
  name: z.string().min(1).max(64).regex(SKILL_NAME_PATTERN, {
    message:
      "name must be lowercase and may include letters, numbers, and hyphens",
  }),
  description: z.string().min(1).max(1024),
  skill_markdown: z.string().min(1).max(20480),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().optional(),
  scope: SkillScopeSchema.optional(),
});

export const UpdateAgentSkillSchema = CreateAgentSkillSchema.partial();

export const UpsertSkillFileSchema = z.object({
  relative_path: z.string().min(1).max(512),
  content: z.string().optional(),
  content_base64: z.string().optional(),
});

export const AgentSkillsQuerySchema = z.object({
  include_inactive: z.preprocess((value) => {
    if (typeof value === "string") {
      return value === "true";
    }
    if (typeof value === "boolean") {
      return value;
    }
    return false;
  }, z.boolean()),
});

export * from "./skills.types";
