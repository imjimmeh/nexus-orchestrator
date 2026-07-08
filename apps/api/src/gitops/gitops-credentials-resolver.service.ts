import { Inject, Injectable, Logger } from '@nestjs/common';
import { SecretCrudService } from '../security/services/secret-crud.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';
import {
  decodeSecretValue,
  extractHost,
  inferSecretKind,
  isSshUrl,
  sanitiseThrownError,
  toHttpsCredentials,
  toSshPrivateKey,
} from './gitops-credentials-resolver.helpers';
import type {
  GitOpsCredentialsFailedEvent,
  GitOpsCredentialsMissingEvent,
  GitOpsCredentialsOptions,
  GitOpsCredentialsResolvedEvent,
  ResolvedHttpsCredentials,
} from './gitops-credentials-resolver.service.types';

/**
 * Injection token for the constructor-injectable
 * `GitOpsCredentialsOptions` provider. Milestone-2 will wire
 * the actual `GITOPS_REQUIRE_CREDENTIALS` env reading here;
 * for this milestone the resolver only consumes the shape.
 */
export const GITOPS_CREDENTIALS_OPTIONS = 'GITOPS_CREDENTIALS_OPTIONS';

/**
 * Default options applied when no provider overrides the
 * injection token. Mirrors the milestone requirements:
 * strict mode is OFF by default and well-known public hosts
 * are pre-approved for anonymous access.
 */
export const DEFAULT_GITOPS_CREDENTIALS_OPTIONS: GitOpsCredentialsOptions = {
  requireCredentials: false,
  ttlMs: 60_000,
  anonymousAllowedHosts: ['github.com', 'gitlab.com', 'bitbucket.org'],
};

/**
 * Cache entry shape used by the in-memory TTL map.
 *
 * `value` is intentionally typed as `unknown` because the
 * resolver must accept the JSON-decoded shape returned by
 * `SecretCrudService.findByIdRaw` (which is the encrypted
 * JSON-encoded payload), or any object/string variant. The
 * private `inferSecretKind` helper narrows it before the
 * caller-facing return.
 */
interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * Typed error thrown by `GitOpsCredentialsResolver` when a
 * fatal resolution failure occurs (strict-mode ON, missing or
 * unresolvable credentials, malformed secret payload). The
 * class is intentionally lightweight: it carries only the
 * identifiers needed for an operator to identify the binding
 * and secret at fault, plus a sanitised reason. The
 * credential value is never put on this object — that is a
 * hard invariant of the resolver.
 */
export class CredentialResolutionError extends Error {
  readonly bindingId: string;
  readonly secretId: string | null;
  readonly reason: string;

  constructor(params: {
    bindingId: string;
    secretId: string | null;
    reason: string;
  }) {
    super(
      `Failed to resolve GitOps credentials for binding ${params.bindingId}` +
        (params.secretId ? ` (secret ${params.secretId})` : '') +
        `: ${params.reason}`,
    );
    this.name = 'CredentialResolutionError';
    this.bindingId = params.bindingId;
    this.secretId = params.secretId;
    this.reason = params.reason;
  }
}

/**
 * Foundational credential-resolution primitive for the GitOps
 * binding system. Downstream consumers (the inbound reconcile
 * fetch path and the outbound sync push path — both scheduled
 * for Milestone 2) inject this service and call:
 *
 *   - `resolveHttpsCredentials(binding)` for HTTPS URLs
 *     (`https://...`), returning `{ username, password }`.
 *   - `resolveSshPrivateKey(binding)` for SSH URLs
 *     (`git@host:...` or `ssh://...`), returning the private
 *     key blob as a string.
 *
 * Resolved values are cached in-memory for `options.ttlMs`
 * (default 60 seconds) keyed by secret ID to keep the
 * reconcile tick off the secret-store hot path.
 *
 * The resolver classifies the secret's "kind" by inspecting
 * the decrypted value's shape:
 *
 * 1. If the value is a JSON object with a `kind` or `type`
 *    discriminator field set to `'ssh'`, `'https'`,
 *    `'ssh_private_key'`, `'ssh-private-key'`, `'https_token'`,
 *    `'token'`, etc., the discriminator wins.
 * 2. If the value is a JSON object with `sshPrivateKey` or
 *    `privateKey` keys, it is SSH kind.
 * 3. If the value is a JSON object with `username` and
 *    either `password` or `token`, it is HTTPS kind. The
 *    `token` field is folded into `password` for the
 *    git-credential contract.
 * 4. If the value is a plain string, it is treated as a
 *    token-only HTTPS credential with an empty username.
 * 5. Anything else is treated as `null` (unknown shape) and
 *    surfaces as a resolution failure.
 *
 * Telemetry events emitted on every public-API call:
 *   - `gitops.credentials.resolved` — successful resolution.
 *   - `gitops.credentials.missing` — no secret ID, or strict
 *     mode rejected for a non-anonymous-allowed host.
 *   - `gitops.credentials.failed` — resolution threw or the
 *     secret was found but could not be classified.
 *
 * NONE of these payloads ever carry the credential value.
 */
@Injectable()
export class GitOpsCredentialsResolver {
  private readonly logger = new Logger(GitOpsCredentialsResolver.name);
  private readonly cache: Map<string, CacheEntry> = new Map();

  constructor(
    private readonly secretCrud: SecretCrudService,
    private readonly eventLedger: EventLedgerService,
    @Inject(GITOPS_CREDENTIALS_OPTIONS)
    private readonly options: GitOpsCredentialsOptions,
  ) {}

  /**
   * Resolve HTTPS-style credentials for the binding. Returns
   * `null` when:
   *   - the binding has no `credentialsSecretId` (anonymous
   *     mode, when strict mode is OFF or the host is on the
   *     anonymous-allowed list), or
   *   - strict mode is OFF and resolution failed, or
   *   - the binding's URL is SSH-style (`git@...` or
   *     `ssh://...`), or
   *   - the secret resolved to an SSH-shaped payload (the
   *     caller asked for HTTPS but the binding is configured
   *     with an SSH key).
   *
   * Throws `CredentialResolutionError` when strict mode is
   * ON and the binding has no secret ID against a
   * non-anonymous-allowed host, OR when resolution itself
   * threw unexpectedly.
   */
  async resolveHttpsCredentials(
    binding: GitOpsRepositoryBinding,
  ): Promise<ResolvedHttpsCredentials | null> {
    if (isSshUrl(binding.repoUrl)) {
      // Caller asked for HTTPS but the URL is SSH — there is
      // nothing to resolve on this path. We deliberately do
      // NOT emit a `missing` event here; the SSH consumer is
      // the canonical path for SSH-shaped URLs.
      return null;
    }

    return this.resolveHttpsForBinding(binding);
  }

  /**
   * Resolve an SSH private key for the binding. Returns
   * `null` when:
   *   - the binding has no `credentialsSecretId` (anonymous
   *     mode), or
   *   - strict mode is OFF and resolution failed, or
   *   - the binding's URL is HTTPS-style, or
   *   - the secret resolved to an HTTPS-shaped payload.
   *
   * Throws `CredentialResolutionError` under the same strict-
   * mode conditions as `resolveHttpsCredentials`.
   */
  async resolveSshPrivateKey(
    binding: GitOpsRepositoryBinding,
  ): Promise<string | null> {
    if (!isSshUrl(binding.repoUrl)) {
      // Caller asked for SSH but the URL is HTTPS — nothing
      // to resolve here either.
      return null;
    }

    return this.resolveSshForBinding(binding);
  }

  /**
   * Test/operator hook for clearing the in-memory cache. With
   * a `secretId` argument, removes only that entry. With no
   * argument, clears every entry.
   */
  clearCache(secretId?: string): void {
    if (secretId === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(secretId);
  }

  /**
   * Internal entry point for the HTTPS branch. Splits the
   * credential-resolution policy from the URL-kind check so
   * that SSH-only bindings do not produce misleading
   * `missing` telemetry on the HTTPS path.
   */
  private async resolveHttpsForBinding(
    binding: GitOpsRepositoryBinding,
  ): Promise<ResolvedHttpsCredentials | null> {
    const secretId = binding.credentialsSecretId;
    if (!secretId) {
      return this.asHttpsResult(this.handleMissingSecret(binding));
    }

    try {
      const cached = await this.getCachedOrResolve(secretId);
      if (cached === undefined) {
        // `findByIdRaw` returned null — secret does not exist.
        return this.asHttpsResult(
          this.handleResolutionFailure(binding, secretId, 'secret_not_found'),
        );
      }

      const kind = inferSecretKind(cached.value);
      if (kind === 'ssh') {
        // Caller asked for HTTPS but the secret is shaped SSH.
        // We do NOT attempt to coerce it; that would risk
        // stuffing a private key into a password field.
        return this.asHttpsResult(
          this.handleResolutionFailure(
            binding,
            secretId,
            'secret_shape_mismatch_https_requested_ssh_provided',
          ),
        );
      }
      if (kind === null) {
        return this.asHttpsResult(
          this.handleResolutionFailure(
            binding,
            secretId,
            'unrecognised_secret_shape',
          ),
        );
      }

      const credentials = toHttpsCredentials(cached.value);
      if (credentials === null) {
        return this.asHttpsResult(
          this.handleResolutionFailure(
            binding,
            secretId,
            'unrecognised_secret_shape',
          ),
        );
      }

      this.emitResolved(binding.id, 'https', cached.cached);
      return credentials;
    } catch (error) {
      return this.asHttpsResult(
        this.handleResolutionThrew(binding, secretId, error),
      );
    }
  }

  /**
   * Internal entry point for the SSH branch.
   */
  private async resolveSshForBinding(
    binding: GitOpsRepositoryBinding,
  ): Promise<string | null> {
    const secretId = binding.credentialsSecretId;
    if (!secretId) {
      return this.asSshResult(this.handleMissingSecret(binding));
    }

    try {
      const cached = await this.getCachedOrResolve(secretId);
      if (cached === undefined) {
        return this.asSshResult(
          this.handleResolutionFailure(binding, secretId, 'secret_not_found'),
        );
      }

      const kind = inferSecretKind(cached.value);
      if (kind === 'https') {
        return this.asSshResult(
          this.handleResolutionFailure(
            binding,
            secretId,
            'secret_shape_mismatch_ssh_requested_https_provided',
          ),
        );
      }
      if (kind === null) {
        return this.asSshResult(
          this.handleResolutionFailure(
            binding,
            secretId,
            'unrecognised_secret_shape',
          ),
        );
      }

      const key = toSshPrivateKey(cached.value);
      if (key === null) {
        return this.asSshResult(
          this.handleResolutionFailure(
            binding,
            secretId,
            'unrecognised_secret_shape',
          ),
        );
      }

      this.emitResolved(binding.id, 'ssh', cached.cached);
      return key;
    } catch (error) {
      return this.asSshResult(
        this.handleResolutionThrew(binding, secretId, error),
      );
    }
  }

  /**
   * Narrow a shared-helper return value to the HTTPS-shaped
   * variant. The shared helpers
   * (`handleMissingSecret`, `handleResolutionFailure`,
   * `handleResolutionThrew`) intentionally return a union of
   * `ResolvedHttpsCredentials | string | null` so a single
   * implementation can serve both the HTTPS and SSH call
   * paths. At runtime the helpers always return `null` (the
   * non-null branches are never reached because each helper
   * only throws or emits-and-returns-null), so this narrows
   * any non-null result to `ResolvedHttpsCredentials`. We
   * use a `typeof` type guard rather than an `as` cast to
   * keep the lint policy honest.
   */
  private asHttpsResult(
    result: ResolvedHttpsCredentials | string | null,
  ): ResolvedHttpsCredentials | null {
    if (result === null || typeof result === 'string') {
      return null;
    }
    return result;
  }

  /**
   * Narrow a shared-helper return value to the SSH-shaped
   * variant. See `asHttpsResult` for the rationale.
   */
  private asSshResult(
    result: ResolvedHttpsCredentials | string | null,
  ): string | null {
    if (result === null || typeof result !== 'string') {
      return null;
    }
    return result;
  }

  /**
   * Cache-aware loader. Returns the previously cached value
   * when present and unexpired; otherwise calls
   * `SecretCrudService.findByIdRaw` and refreshes the entry.
   *
   * Returns `undefined` (NOT `null`) for "secret not found"
   * so callers can distinguish a missing secret from a cached
   * miss. The cache stores positive resolutions only; a `null`
   * result from the secret store is treated as a real miss.
   *
   * The second tuple element indicates whether the value was
   * served from the in-memory cache — callers forward it to
   * the `gitops.credentials.resolved` telemetry event so
   * operators can distinguish hot-path resolutions from
   * cache hits in observability dashboards.
   */
  private async getCachedOrResolve(
    secretId: string,
  ): Promise<{ value: unknown; cached: boolean } | undefined> {
    if (this.options.ttlMs > 0) {
      const cached = this.cache.get(secretId);
      const now = Date.now();
      if (cached && cached.expiresAt > now) {
        return { value: cached.value, cached: true };
      }
    }

    const raw = await this.secretCrud.findByIdRaw(secretId);
    if (!raw) {
      return undefined;
    }

    const decoded = decodeSecretValue(raw.decryptedValue);
    if (this.options.ttlMs > 0) {
      this.cache.set(secretId, {
        value: decoded,
        expiresAt: Date.now() + this.options.ttlMs,
      });
    }
    return { value: decoded, cached: false };
  }

  /**
   * Strict-mode-aware "no secret ID" handler. Emits a
   * `missing` event and either returns `null` (anonymous /
   * tolerated) or throws (strict mode against a
   * non-anonymous-allowed host).
   *
   * Returns `ResolvedHttpsCredentials | string | null` so the
   * same helper can serve both the HTTPS path and the SSH
   * path. Each call site narrows the result to its own
   * concrete shape via `asHttpsResult` / `asSshResult`.
   * At runtime the helper always returns `null`; the union
   * exists purely to keep the helper a single shared
   * implementation while letting TypeScript validate the
   * narrowed return at each call site.
   */
  private handleMissingSecret(
    binding: GitOpsRepositoryBinding,
  ): ResolvedHttpsCredentials | string | null {
    const host = extractHost(binding.repoUrl);
    const onAllowedHost =
      host !== null &&
      this.options.anonymousAllowedHosts.includes(host.toLowerCase());

    if (this.options.requireCredentials && !onAllowedHost) {
      this.emitMissing(
        binding.id,
        binding.repoUrl,
        'require_credentials_for_host',
      );
      throw new CredentialResolutionError({
        bindingId: binding.id,
        secretId: null,
        reason: 'require_credentials_for_host',
      });
    }

    this.emitMissing(binding.id, binding.repoUrl);
    return null;
  }

  /**
   * Resolution returned `undefined` (secret not found) OR
   * the secret's shape could not be coerced to the requested
   * kind. In strict mode this is fatal; otherwise we surface
   * `null` to the caller with a `failed` event.
   *
   * Returns `ResolvedHttpsCredentials | string | null`; see
   * `handleMissingSecret` for the rationale.
   */
  private handleResolutionFailure(
    binding: GitOpsRepositoryBinding,
    secretId: string,
    reason: string,
  ): ResolvedHttpsCredentials | string | null {
    this.emitFailed(binding.id, secretId, reason);
    if (this.options.requireCredentials) {
      throw new CredentialResolutionError({
        bindingId: binding.id,
        secretId,
        reason,
      });
    }
    return null;
  }

  /**
   * Resolution threw unexpectedly. In strict mode this is
   * fatal; otherwise we absorb and return `null`. The
   * underlying error is logged at `warn` level so operators
   * see the failure without the credential value (we only
   * pass the error's `name`, never the message body, into
   * the telemetry payload).
   *
   * Returns `ResolvedHttpsCredentials | string | null`; see
   * `handleMissingSecret` for the rationale.
   */
  private handleResolutionThrew(
    binding: GitOpsRepositoryBinding,
    secretId: string,
    error: unknown,
  ): ResolvedHttpsCredentials | string | null {
    const safeReason = sanitiseThrownError(error);
    this.logger.warn(
      `GitOps credential resolution threw for binding ${binding.id} ` +
        `(secret ${secretId}): ${safeReason}`,
    );
    this.emitFailed(binding.id, secretId, safeReason);
    if (this.options.requireCredentials) {
      throw new CredentialResolutionError({
        bindingId: binding.id,
        secretId,
        reason: safeReason,
      });
    }
    return null;
  }

  private emitResolved(
    bindingId: string,
    secretKind: 'https' | 'ssh',
    cached: boolean,
  ): void {
    const payload: GitOpsCredentialsResolvedEvent = {
      bindingId,
      secretKind,
      cached,
      emittedAt: new Date().toISOString(),
    };
    void this.eventLedger.emitBestEffort({
      domain: 'gitops',
      eventName: 'gitops.credentials.resolved',
      outcome: 'success',
      payload: { ...payload },
    });
  }

  private emitMissing(bindingId: string, url: string, reason?: string): void {
    const payload: GitOpsCredentialsMissingEvent = reason
      ? { bindingId, url, emittedAt: new Date().toISOString(), reason }
      : { bindingId, url, emittedAt: new Date().toISOString() };
    void this.eventLedger.emitBestEffort({
      domain: 'gitops',
      eventName: 'gitops.credentials.missing',
      outcome: 'success',
      payload: { ...payload },
    });
  }

  private emitFailed(
    bindingId: string,
    secretId: string,
    reason: string,
  ): void {
    const payload: GitOpsCredentialsFailedEvent = {
      bindingId,
      secretId,
      reason,
      emittedAt: new Date().toISOString(),
    };
    void this.eventLedger.emitBestEffort({
      domain: 'gitops',
      eventName: 'gitops.credentials.failed',
      outcome: 'failure',
      payload: { ...payload },
    });
  }
}
