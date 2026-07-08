import { z } from "zod";

export const jobContextSchema = z.object({
  workflowRunId: z.string(),
  stepId: z.string(),
  agentId: z.string().optional(),
});

export const artifactIdSchema = z.object({
  artifactId: z.string(),
});

export const artifactFileIdSchema = z.object({
  artifactId: z.string(),
  fileId: z.string(),
});

export const skillIdSchema = z.object({
  skillId: z.string(),
});

export const skillFileIdSchema = z.object({
  skillId: z.string(),
  fileId: z.string(),
});

export const profileIdSchema = z.object({
  profileId: z.string(),
});

export const hostMountsSchema = z
  .object({
    mounts: z.record(z.string(), z.string()).optional(),
  })
  .optional();

export const fileOperationSchema = z
  .object({
    path: z.string(),
    content: z.string().optional(),
    encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
  })
  .optional();
