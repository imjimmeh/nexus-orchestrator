import { z } from "zod";

export const SetupStatusResponseSchema = z.object({
  requiresSetup: z.boolean(),
  hasAnySecret: z.boolean(),
  hasActiveProvider: z.boolean(),
  hasActiveModel: z.boolean(),
  hasArchitectProfile: z.boolean(),
});

export type SetupStatusResponse = z.infer<typeof SetupStatusResponseSchema>;
