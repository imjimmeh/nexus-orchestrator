import { z } from "zod";

export const retrieveSecretSchema = z.object({
  secretId: z.uuid(),
});

export type RetrieveSecretRequest = z.infer<typeof retrieveSecretSchema>;
