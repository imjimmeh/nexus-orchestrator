import type { EnforcementMode } from './enforcement-mode.types';

export type { EnforcementMode } from './enforcement-mode.types';

export const ENFORCEMENT_MODES = ['audit', 'warn', 'enforce'] as const;
export const DEFAULT_ENFORCEMENT_MODE: EnforcementMode = 'audit';
export const ENFORCEMENT_MODE_KEY_PREFIX = 'rbac_enforcement_mode.';
export const ENFORCEMENT_MODE_GLOBAL_KEY = `${ENFORCEMENT_MODE_KEY_PREFIX}__global__`;

export function enforcementModeKey(resource: string): string {
  return `${ENFORCEMENT_MODE_KEY_PREFIX}${resource}`;
}

export function coerceEnforcementMode(value: unknown): EnforcementMode {
  return (ENFORCEMENT_MODES as readonly string[]).includes(value as string)
    ? (value as EnforcementMode)
    : DEFAULT_ENFORCEMENT_MODE;
}
