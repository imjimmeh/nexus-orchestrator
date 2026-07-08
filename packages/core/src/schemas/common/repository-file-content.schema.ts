import { z } from "zod";

export const RepositoryFileContentSchema = z.object({
  content: z.string(),
  path: z.string(),
  branch: z.string(),
  size: z.number(),
});

export type RepositoryFileContent = z.infer<typeof RepositoryFileContentSchema>;
