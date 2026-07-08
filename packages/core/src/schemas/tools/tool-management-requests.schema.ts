import {
  SortDirection,
  ToolSortField,
} from "../../interfaces/tool-query.types";
import { z } from "zod";

export const candidateLanguageSchema = z.enum(["node", "python"]);
export const candidateStatusSchema = z.enum([
  "draft",
  "validated",
  "published",
  "failed",
]);

export const createToolSchema = z.object({
  name: z.string(),
  schema: z.record(z.string(), z.unknown()),
  typescript_code: z.string(),
  tier_restriction: z.number().int().optional().default(0),
  language: candidateLanguageSchema.optional(),
  publication_status: candidateStatusSchema.optional(),
  published_artifact_id: z.string().nullable().optional(),
  published_version: z.coerce.number().int().nullable().optional(),
});

export const upsertToolSchema = createToolSchema;

export const updateToolSchema = z.object({
  name: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  typescript_code: z.string().optional(),
  tier_restriction: z.coerce.number().int().optional(),
  language: candidateLanguageSchema.optional(),
  publication_status: candidateStatusSchema.optional(),
  published_artifact_id: z.string().nullable().optional(),
  published_version: z.coerce.number().int().nullable().optional(),
});

export const toolPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  search: z.string().optional(),
  sortBy: z.enum(ToolSortField).optional().default(ToolSortField.NAME),
  sortDir: z.enum(SortDirection).optional().default(SortDirection.ASC),
});

export const createCandidateDraftSchema = z.object({
  tool_name: z.string(),
  language: candidateLanguageSchema.optional().default("node"),
  source_code: z.string(),
  schema: z.record(z.string(), z.unknown()),
  test_spec: z.string().optional(),
});

export const candidatePaginationSchema = toolPaginationSchema.extend({
  status: candidateStatusSchema.optional(),
  tool_name: z.string().optional(),
});

export const executePublishedToolSchema = z.object({
  params: z.record(z.string(), z.unknown()).optional(),
});

const ScopeSchema = z.enum(["global", "profile"]);

export const createArtifactInputSchema = z.object({
  artifact_id: z.string().optional(),
  name: z.string(),
  description: z.string(),
  scope: ScopeSchema.optional(),
  owner_profile: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const listArtifactsInputSchema = z.object({
  query: z.string().optional(),
  scope: ScopeSchema.optional(),
  owner_profile: z.string().optional(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
  limit: z.number().optional().default(50),
  offset: z.number().optional().default(0),
});

export const listArtifactFilesInputSchema = z.object({
  artifact_id: z.string(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const upsertArtifactFileInputSchema = z.object({
  artifact_id: z.string(),
  relative_path: z.string(),
  content: z.string().optional(),
  content_base64: z.string().optional(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const deleteArtifactFileInputSchema = z.object({
  artifact_id: z.string(),
  relative_path: z.string(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const saveScriptAsArtifactInputSchema = z.object({
  artifact_id: z.string().optional(),
  name: z.string(),
  description: z.string(),
  script_content: z.string(),
  relative_path: z.string().optional(),
  scope: ScopeSchema.optional(),
  owner_profile: z.string().optional(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const createToolCandidateInputSchema = z.object({
  tool_name: z.string(),
  language: candidateLanguageSchema,
  source_code: z.string(),
  schema: z.looseObject({}),
  test_spec: z.string().optional(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const validateToolCandidateInputSchema = z.object({
  artifact_id: z.string(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const publishToolCandidateInputSchema = z.object({
  artifact_id: z.string(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const upsertToolInputSchema = z.object({
  name: z.string(),
  schema: z.looseObject({}),
  typescript_code: z.string(),
  language: candidateLanguageSchema,
  publication_status: candidateStatusSchema.optional(),
  published_artifact_id: z.string().optional(),
  published_version: z.string().optional(),
  tier_restriction: z.enum(["1", "2"]),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const createSkillInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  skill_markdown: z.string(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const updateSkillInputSchema = z.object({
  skill_id: z.string(),
  name: z.string().optional(),
  skill_markdown: z.string().optional(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const listSkillFilesInputSchema = z.object({
  skill_id: z.string(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const upsertSkillFileInputSchema = z.object({
  skill_id: z.string(),
  relative_path: z.string(),
  content: z.string().optional(),
  content_base64: z.string().optional(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const deleteSkillFileInputSchema = z.object({
  skill_id: z.string(),
  relative_path: z.string(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const replaceProfileSkillsInputSchema = z.object({
  profile_id: z.string(),
  skill_ids: z.array(z.string()),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const addProfileSkillsInputSchema = z.object({
  profile_id: z.string(),
  skill_ids: z.array(z.string()),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const removeProfileSkillsInputSchema = z.object({
  profile_id: z.string(),
  skill_ids: z.array(z.string()),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const saveScriptAsSkillInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  script_content: z.string(),
  relative_path: z.string().optional(),
  profile_id: z.string().optional(),
  overwrite_existing: z.boolean().optional(),
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export type CandidateLanguage = z.infer<typeof candidateLanguageSchema>;
export type CandidateStatus = z.infer<typeof candidateStatusSchema>;
export type CreateToolRequest = z.infer<typeof createToolSchema>;
export type UpsertToolRequest = z.infer<typeof upsertToolSchema>;
export type UpdateToolRequest = z.infer<typeof updateToolSchema>;
export type ToolPaginationRequest = z.infer<typeof toolPaginationSchema>;
export type CreateCandidateDraftRequest = z.infer<
  typeof createCandidateDraftSchema
>;
export type CandidatePaginationRequest = z.infer<
  typeof candidatePaginationSchema
>;
export type ExecutePublishedToolRequest = z.infer<
  typeof executePublishedToolSchema
>;
