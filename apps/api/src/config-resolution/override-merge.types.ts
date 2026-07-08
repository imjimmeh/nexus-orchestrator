import type { OverrideStrategy } from './config-resolution.constants.types';

export interface OverrideStep<T> {
  strategy: OverrideStrategy;
  definition: T | null;
  overrides: Record<string, unknown> | null;
}
