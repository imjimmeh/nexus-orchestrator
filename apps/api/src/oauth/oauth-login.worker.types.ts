/**
 * API-local payload + journal types for the BullMQ durable-worker migration
 * of `OAuthLoginService`'s transient half (follow-up §1 of
 * `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`,
 * work item `53b39246-followup-bullmq-worker`).
 *
 * These types are intentionally local (not in `@nexus/core`) because they
 * describe the worker-internal journal shape that may evolve independently
 * of the durable half. The queue + job-name identifiers
 * (`OAUTH_LOGIN_SESSION_JOB_QUEUE` / `OAUTH_LOGIN_RUN_JOB`) live in
 * `@nexus/core` (see `packages/core/src/schemas/oauth/oauth-login.schema.ts`)
 * so every producer across the monorepo imports the same runtime constant;
 * the payload + journal types live here because they are the worker's
 * transient-durability layer, not a cross-boundary contract.
 */

/**
 * Initial job payload submitted to the BullMQ
 * `OAUTH_LOGIN_SESSION_JOB_QUEUE`.
 */
export interface OAuthLoginJobPayload {
  /** Canonical session identifier; matches the durable Redis key suffix. */
  sessionId: string;
  /** pi-ai OAuth preset id (e.g. `"anthropic"`, `"github-copilot"`). */
  piProviderId: string;
  /** Optional enterprise / domain answer for providers that prompt for it. */
  enterpriseUrl?: string;
  // Note: journal is stored on BullMQ job.progress, NOT on data;
  // omit journal from the initial payload interface.
}

/**
 * Discriminated union of the SDK callbacks the worker journals onto the
 * durable job.
 *
 * The `type` discriminator is the only key the worker pattern-matches
 * against when replaying the journal; the remaining keys are the
 * observable SDK callback arguments (or, for terminal transitions, the
 * worker's own bookkeeping). Adding a new event means extending this
 * union — never mutating an existing variant — so a replay against a
 * stale worker cannot silently drop the event.
 */
export type OAuthLoginJournalEvent =
  | { type: 'auth_initiated'; authorizeUrl: string; instructions?: string }
  | {
      type: 'device_initiated';
      userCode: string;
      verificationUri: string;
      intervalSeconds: number;
    }
  | { type: 'code_delivered'; code: string }
  | { type: 'abort_issued' }
  | { type: 'connected' }
  | { type: 'failed'; message: string };

/** Ordered replay buffer of SDK callbacks the worker has observed for a session. */
export interface OAuthLoginJobJournal {
  events: OAuthLoginJournalEvent[];
}

/**
 * Full job-data shape carried in BullMQ `job.data`: extends the initial
 * payload with the journal buffer that the worker persists via
 * `Job.updateProgress` (per the worker's transient-durability contract).
 */
export interface OAuthLoginJobData extends OAuthLoginJobPayload {
  journal: OAuthLoginJobJournal;
}
