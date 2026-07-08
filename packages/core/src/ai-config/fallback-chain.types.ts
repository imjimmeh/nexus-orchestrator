export interface FallbackChainEntry {
  provider_name: string;
  model_name: string;
}

export type ProviderCooldownReason =
  | "usage_exhausted"
  | "billing_exhausted"
  | "auth_failed"
  | "provider_outage";

export interface FallbackChain {
  name: string;
  entries: FallbackChainEntry[];
}

export interface ProviderCooldownStatus {
  provider_name: string;
  reason: ProviderCooldownReason;
  cooled_until: string; // ISO-8601
  last_failure_at: string; // ISO-8601
  source_run_id?: string | null;
}

export const FALLBACK_COOLDOWN_DEFAULT_MS: Record<
  ProviderCooldownReason,
  number
> = {
  usage_exhausted: 30 * 60 * 1000,
  billing_exhausted: 30 * 60 * 1000,
  auth_failed: 30 * 60 * 1000,
  provider_outage: 2 * 60 * 1000,
};
