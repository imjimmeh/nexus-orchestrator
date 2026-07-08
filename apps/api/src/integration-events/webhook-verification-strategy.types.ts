export const WEBHOOK_VERIFICATION_STRATEGIES = Symbol(
  'WEBHOOK_VERIFICATION_STRATEGIES',
);

export type WebhookHeaders = Record<string, string | undefined>;

export interface MergeIdentity {
  provider: string;
  owner: string;
  repo: string;
  prNumber: number;
  mergeCommitSha: string;
}

/**
 * Per-provider webhook handling: verify the request authenticity (HMAC or shared
 * token) and, when the event represents a completed merge, extract the neutral
 * merge identity the shared finalizer consumes. Returns null for non-merge events.
 */
export interface WebhookVerificationStrategy {
  readonly providerKey: string;
  verify(rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean;
  extractMerge(parsedBody: unknown): MergeIdentity | null;
}
