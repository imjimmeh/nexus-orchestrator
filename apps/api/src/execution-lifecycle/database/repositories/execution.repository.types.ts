export interface ResolvedConfigPatch {
  provider?: string | null;
  model?: string | null;
  agent_profile_id?: string | null;
  agent_profile_name?: string | null;
  harness_id?: string | null;
  provider_source?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
}

export interface OwnerLeaseParams {
  executionId: string;
  ownerInstanceId: string;
  now: Date;
  leaseExpiresAt: Date;
}
