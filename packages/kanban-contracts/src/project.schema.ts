import { z } from "zod";
import type { RuntimeToolchainConfig } from "@nexus/core";

export const ProjectSourceTypeSchema = z.enum([
  "create_new",
  "import_local",
  "import_remote",
]);

// Core is the shared, Kanban-neutral source of truth for toolchain config —
// re-validating its shape here would duplicate packages/core's resolver rules.
const RuntimeToolchainConfigSchema = z.custom<RuntimeToolchainConfig>();

export const ProjectRecordSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    goals: z.string().nullable(),
    repositoryUrl: z.string().nullable().optional(),
    basePath: z.string().nullable().optional(),
    githubSecretId: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    sourceType: ProjectSourceTypeSchema.nullable().optional(),
    copyToWorkspace: z.boolean().nullable().optional(),
    onboardingRunId: z.string().optional(),
    orchestrationSettings: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional(),
    runtime_toolchains: RuntimeToolchainConfigSchema.nullable().optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const ProjectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    repositoryUrl: z.string().nullable().optional(),
    basePath: z.string().nullable().optional(),
    githubSecretId: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    runtime_toolchains: RuntimeToolchainConfigSchema.nullable().optional(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict();

export const ProjectGoalInputSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    moscow: z.string().optional(),
    priority: z.string().optional(),
    target_date: z.string().optional(),
  })
  .strict();

export const IngestionInputsSchema = z
  .object({
    files: z.array(z.string()).optional(),
    urls: z.array(z.string()).optional(),
  })
  .strict();

export const CreateProjectInputSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    sourceType: ProjectSourceTypeSchema.optional(),
    repositoryUrl: z.string().optional(),
    basePath: z.string().optional(),
    githubSecretId: z.string().optional(),
    copyToWorkspace: z.boolean().optional(),
    goals: z.array(ProjectGoalInputSchema).optional(),
    ingestionInputs: IngestionInputsSchema.optional(),
    startOnboarding: z.boolean().optional(),
  })
  .strict();

export const CreateProjectRequestSchema = CreateProjectInputSchema;

export const UpdateProjectRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    repositoryUrl: z.string().optional(),
    basePath: z.string().optional(),
    githubSecretId: z.string().optional(),
    description: z.string().optional(),
    runtime_toolchains: RuntimeToolchainConfigSchema.nullable().optional(),
  })
  .strict();
