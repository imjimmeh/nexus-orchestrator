import type { PutGlobalFallbackChainSchema } from './fallback-chain.dto';
import type { z } from 'zod';

export type PutGlobalFallbackChainRequest = z.infer<
  typeof PutGlobalFallbackChainSchema
>;
