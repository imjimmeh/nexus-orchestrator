export const DELEGATION_TARGET_TIER_VALUES = ['light', 'heavy'] as const;

export type DelegationTargetTier =
  (typeof DELEGATION_TARGET_TIER_VALUES)[number];

export const DELEGATION_CONTRACT_STATUS_VALUES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'denied',
] as const;

export type DelegationContractStatus =
  (typeof DELEGATION_CONTRACT_STATUS_VALUES)[number];
