import { z } from 'zod';

const FallbackChainEntryInputSchema = z.object({
  provider_name: z.string().min(1, 'provider_name must be non-empty'),
  model_name: z.string().min(1, 'model_name must be non-empty'),
});

export const PutGlobalFallbackChainSchema = z.object({
  entries: z.array(FallbackChainEntryInputSchema),
});
