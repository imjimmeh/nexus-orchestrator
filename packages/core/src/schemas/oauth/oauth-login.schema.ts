import { z } from "zod";

/**
 * BullMQ runtime identifiers for the OAuth login durable-worker migration
 * (follow-up §1 of
 * `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`,
 * work item `53b39246-followup-bullmq-worker`).
 *
 * These constants are the cross-process contract between
 * `OAuthLoginService` (producer) and the future
 * `apps/api/src/oauth/oauth-login.worker.ts` BullMQ processor (consumer):
 * every pod that enqueues a session must use the same queue name, and
 * every pod that registers the worker must consume the same job name, so
 * the queue and the worker cannot drift apart.
 *
 * Why these live in `@nexus/core` rather than the API package:
 *   `@nexus/core` already owns the canonical OAuth login schemas
 *   (`OAuthSessionState`, `OAuthStartResult`, ...). Centralising the
 *   runtime identifiers here means every producer across the
 *   monorepo imports the same constant from `@nexus/core/schemas/oauth`,
 *   mirroring the `MEMORY_EVICTION_QUEUE` / `MEMORY_DECAY_QUEUE`
 *   precedent in the memory module — and never hardcodes the string
 *   at the call site.
 *
 * Snake-case uppercase for the identifier and lowercase snake-case for
 * the queue value follow the same naming convention as the memory
 * module's BullMQ constants.
 */

/** BullMQ queue name for in-flight OAuth login session workers. */
export const OAUTH_LOGIN_SESSION_JOB_QUEUE = "oauth-login" as const;

/**
 * BullMQ job-name string for the per-session `provider.login` invocation.
 * The worker processor only handles this name and logs + ignores any
 * other name that lands on the queue, mirroring the
 * {@link MEMORY_DECAY_JOB_NAME} dispatch contract used by the memory-
 * decay reaper processor.
 */
export const OAUTH_LOGIN_RUN_JOB = "run" as const;

/** Login modality decided by the OAuth provider at runtime. */
export const oauthModalitySchema = z.enum(["device", "authcode"]);

/** Lifecycle of a single in-flight OAuth login session. */
export const oauthSessionStatusValueSchema = z.enum([
  "pending",
  "connected",
  "failed",
  "expired",
  "denied",
]);

/** Result of starting an OAuth login (device-code or authorization-code). */
export const OAuthStartResultSchema = z.object({
  sessionId: z.string(),
  modality: oauthModalitySchema,
  userCode: z.string().optional(),
  verificationUri: z.string().optional(),
  intervalSeconds: z.number().optional(),
  authorizeUrl: z.string().optional(),
  instructions: z.string().optional(),
  /** ISO-8601 expiry of the login session. */
  expiresAt: z.string(),
});

export const OAuthSessionStatusSchema = z.object({
  status: oauthSessionStatusValueSchema,
  modality: oauthModalitySchema.optional(),
  error: z.string().optional(),
  /** ISO-8601 timestamp of the first transient-half takeover, if any. */
  session_taken_over_at: z.string().optional(),
});

/**
 * Canonical durable half of an in-flight OAuth login session.
 *
 * Mirrors the public observable state of the login service's private session
 * record minus the two runtime primitives that cannot be serialised
 * (`AbortController`, the manual-code Promise resolver). The transient half
 * stays in a per-pod in-memory map; this shape is what the OAuth login session
 * store persists in Redis under the `oauth:session:{sessionId}` namespace.
 *
 * See `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`
 * for the durable / transient split rationale.
 */
export const OAuthSessionStateSchema = z.object({
  id: z.string(),
  status: oauthSessionStatusValueSchema,
  modality: oauthModalitySchema.optional(),
  userCode: z.string().optional(),
  verificationUri: z.string().optional(),
  intervalSeconds: z.number().optional(),
  authorizeUrl: z.string().optional(),
  instructions: z.string().optional(),
  error: z.string().optional(),
  /** ISO-8601 expiry timestamp. */
  expiresAt: z.string(),
  /** ISO-8601 timestamp of the first transient-half takeover, if any. */
  session_taken_over_at: z.string().optional(),
});

/** Body to start a provider-page OAuth login. */
export const StartProviderOAuthRequestSchema = z.object({
  enterprise_url: z.string().optional(),
});

/** Body to start a harness-credential OAuth login. */
export const StartHarnessOAuthRequestSchema = z.object({
  scopeNodeId: z.string().nullable().optional(),
});

/** Body to submit a pasted authorization code / redirect URL. */
export const SubmitOAuthCodeRequestSchema = z.object({
  session_id: z.string().min(1),
  code: z.string().min(1),
});
