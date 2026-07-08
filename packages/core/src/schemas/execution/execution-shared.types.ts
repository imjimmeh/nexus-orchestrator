import { z } from "zod";
import {
  jobContextSchema,
  artifactIdSchema,
  artifactFileIdSchema,
  skillIdSchema,
  skillFileIdSchema,
  profileIdSchema,
  hostMountsSchema,
  fileOperationSchema,
} from "./execution-shared.schemas";

export type JobContext = z.infer<typeof jobContextSchema>;
export type ArtifactId = z.infer<typeof artifactIdSchema>;
export type ArtifactFileId = z.infer<typeof artifactFileIdSchema>;
export type SkillId = z.infer<typeof skillIdSchema>;
export type SkillFileId = z.infer<typeof skillFileIdSchema>;
export type ProfileId = z.infer<typeof profileIdSchema>;
export type HostMounts = z.infer<typeof hostMountsSchema>;
export type FileOperation = z.infer<typeof fileOperationSchema>;
