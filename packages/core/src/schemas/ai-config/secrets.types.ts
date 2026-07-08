import { z } from "zod";
import { CreateSecretSchema, UpdateSecretSchema } from "./secrets.schema";

export type CreateSecretRequest = z.infer<typeof CreateSecretSchema>;
export type UpdateSecretRequest = z.infer<typeof UpdateSecretSchema>;
