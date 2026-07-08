import { z } from "zod";

export const initializeSetupSchema = z.object({
  providerName: z.string().min(1),
  providerBaseUrl: z.string().optional(),
  secretName: z.string().optional(),
  secretKeyName: z.string().optional(),
  secretValue: z.string().min(1),
  modelName: z.string().min(1),
  tokenLimit: z.coerce.number().int().min(1).max(2_000_000).optional(),
});

export type InitializeSetupRequest = z.infer<typeof initializeSetupSchema>;
