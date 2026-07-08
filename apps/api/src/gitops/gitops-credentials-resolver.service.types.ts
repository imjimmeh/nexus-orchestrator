/**
 * Public types for `GitOpsCredentialsResolver`.
 *
 * Kept in a dedicated `*.types.ts` file per the project's
 * `no-restricted-syntax` ESLint rule (exported type aliases
 * belong here, not in the implementation file).
 */

/**
 * Constructor-injectable options for `GitOpsCredentialsResolver`.
 *
 * The Milestone-2 wiring will populate this provider from
 * `GITOPS_REQUIRE_CREDENTIALS` (and friends) via a NestJS
 * factory. For this milestone the resolver only consumes the
 * shape; env wiring is intentionally deferred.
 */
export interface GitOpsCredentialsOptions {
  /**
   * When `true`, missing or unresolvable credentials against
   * a non-anonymous-allowed host MUST throw a typed
   * `CredentialResolutionError`. When `false` (default), a
   * missing secret ID is tolerated and surfaces as a
   * `gitops.credentials.missing` telemetry event with the
   * operation continuing in anonymous mode.
   */
  requireCredentials: boolean;

  /**
   * TTL in milliseconds for the in-memory cache of resolved
   * secret values, keyed by secret ID. A value of `0`
   * disables caching.
   */
  ttlMs: number;

  /**
   * Hosts that are allowed to operate without credentials even
   * when `requireCredentials` is `true`. Lower-cased; the
   * resolver normalises the host before comparison.
   */
  anonymousAllowedHosts: string[];
}

/**
 * Resolved HTTPS credentials suitable for embedding into a
 * `https://user:password@host/...` URL or a `git credential
 * helper` payload.
 *
 * The `password` field is intentionally named to match the
 * git-credential contract (`username` / `password`). For token-
 * only secrets the password carries the token and `username`
 * is the empty string (git treats empty username as "use the
 * token only" when paired with a PAT).
 */
export interface ResolvedHttpsCredentials {
  username: string;
  password: string;
}

/**
 * Discriminated union of the resolved-credential payload
 * shapes the resolver can produce.
 *
 * - `'https'` — an object or string that resolved to a
 *   `{ username, password }` pair.
 * - `'ssh'` — an object or string that resolved to a private
 *   key blob (PEM or OpenSSH format).
 * - `null` — the secret is missing, anonymous mode, or the
 *   resolved value's shape was not recognised.
 */
export type ResolvedSecretKind = 'https' | 'ssh' | null;

/**
 * Payload contract for `gitops.credentials.resolved` telemetry
 * events. Documented here so tests and consumers can type-check
 * event payloads against the canonical schema.
 */
export interface GitOpsCredentialsResolvedEvent {
  bindingId: string;
  secretKind: 'https' | 'ssh';
  cached: boolean;
  emittedAt: string;
}

/**
 * Payload contract for `gitops.credentials.missing` telemetry
 * events. Emitted when a binding has no `credentialsSecretId`
 * and strict mode does not apply (anonymous mode), or when
 * strict mode rejects a non-anonymous-allowed host.
 */
export interface GitOpsCredentialsMissingEvent {
  bindingId: string;
  url: string;
  emittedAt: string;
  /**
   * When strict mode is the reason for the missing payload,
   * this carries the rationale (e.g.
   * `"require_credentials_for_host"`). `undefined` for plain
   * anonymous mode.
   */
  reason?: string;
}

/**
 * Payload contract for `gitops.credentials.failed` telemetry
 * events. The `reason` is a sanitised label only — the
 * resolver NEVER puts the credential value, the resolved
 * password, the SSH key, or the raw secret-store error
 * message body in this payload.
 */
export interface GitOpsCredentialsFailedEvent {
  bindingId: string;
  secretId: string;
  reason: string;
  emittedAt: string;
}
