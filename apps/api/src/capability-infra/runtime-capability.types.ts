import type { ZodTypeAny } from 'zod';
import type { CapabilityManifestEntry } from './capability-manifest.types';

export interface RuntimeCapabilityDefinition<
  TSchema extends ZodTypeAny = ZodTypeAny,
> extends Omit<CapabilityManifestEntry, 'schema' | 'typescriptCode'> {
  inputSchema: TSchema;
  typescriptCode?: string;
}

export function normalizeTierRestriction(value: number): 1 | 2 {
  return value === 1 ? 1 : 2;
}
