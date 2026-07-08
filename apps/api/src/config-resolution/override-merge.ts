import type { OverrideStep } from './override-merge.types';

export type { OverrideStep } from './override-merge.types';

export function applyOverride<T>(base: T | null, step: OverrideStep<T>): T {
  if (step.strategy === 'replace') {
    if (step.definition === null)
      throw new Error('replace override requires a definition');
    return step.definition;
  }
  if (step.overrides === null)
    throw new Error('merge override requires an overrides patch');
  return { ...(base ?? ({} as T)), ...(step.overrides as Partial<T>) };
}
