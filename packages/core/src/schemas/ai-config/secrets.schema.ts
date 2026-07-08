import { z } from "zod";

export const CreateSecretSchema = z.object({
  name: z.string().min(1),
  value: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateSecretSchema = CreateSecretSchema.partial();

export * from "./secrets.types";
