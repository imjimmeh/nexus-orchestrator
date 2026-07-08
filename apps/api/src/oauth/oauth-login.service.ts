import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import {
  OAUTH_LOGIN_SESSION_BUS,
  OAUTH_LOGIN_SESSION_STORE,
  OAUTH_PROVIDER_RESOLVER,
  type OAuthLoginSessionBus,
  type OAuthLoginSessionDurable,
  type OAuthProviderResolver,
  type OAuthSink,
  type OAuthStartParams,
} from './oauth-login.types';
import {
  OAUTH_LOGIN_RUN_JOB,
  OAUTH_LOGIN_SESSION_JOB_QUEUE,
  type OAuthSessionStatus,
  type OAuthSessionStatusValue,
  type OAuthStartResult,
} from '@nexus/core/schemas/oauth';
import { OAuthLoginSessionStore } from './oauth-login-session.store';
import { OAuthInstrumentation } from './oauth-instrumentation';
import type { OAuthLoginJobData } from './oauth-login.worker.types';

const SESSION_TTL_SECONDS = 900; // 15 minutes — enforced via `SET ... EX` in Redis.

/**
 * Single OAuth login orchestrator built on the pi-ai SDK. It enqueues a
 * durable BullMQ job ({@link OAUTH_LOGIN_RUN_JOB}) on the
 * {@link OAUTH_LOGIN_SESSION_JOB_QUEUE} queue and lets
 * {@link OAuthLoginWorker} drive `OAuthProviderInterface.login` for every
 * provider; whichever modality the provider picks (device-code via
 * `onDeviceCode`, authorization code via `onAuth` + manual paste / callback
 * server) is journaled into the durable Redis record and surfaced via
 * {@link OAuthLoginService.getStatus}.
 *
 * Session state is split across two stores:
 *
 * - **Durable half** (id, status, modality, codes, `expiresAt`) — persisted
 *   in Redis via {@link OAuthLoginSessionStore} under the
 *   `oauth:session:{sessionId}` namespace with a 900-second TTL. Cross-pod
 *   safe; survives pod restart.
 * - **Worker-owned per-pod state** (the per-session `AbortController`,
 *   the manual-code Promise resolver, the in-flight `provider.login`
 *   Promise) — owned exclusively by the worker that picked up the
 *   BullMQ job. The legacy per-pod in-process `Map<sessionId, ...>`
 *   field that lived on this service has been removed (M3 of work item
 *   `d8744e56-292b-45bf-9217-42418427891a`); the BullMQ queue is the
 *   source of truth for "is there a live job", which the orphan-
 *   detection branch in {@link getStatus} queries directly.
 *
 * Cross-pod delivery of the user-pasted authorization code is routed through
 * {@link OAuthLoginSessionBus}: the worker subscribes before the in-flight
 * `provider.login` Promise ever awaits on the manual-code channel (see
 * `OAuthLoginWorker.subscribeToCodeChannel`); any pod that receives an HTTP
 * `submitCode` request publishes to the same channel via
 * {@link OAuthLoginService.submitCode}.
 *
 * See `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`
 * for the full architectural rationale.
 */
@Injectable()
export class OAuthLoginService {
  constructor(
    @InjectQueue(OAUTH_LOGIN_SESSION_JOB_QUEUE)
    private readonly loginQueue: Queue<OAuthLoginJobData>,
    @Inject(OAUTH_LOGIN_SESSION_STORE)
    private readonly sessionStore: OAuthLoginSessionStore,
    @Inject(OAUTH_LOGIN_SESSION_BUS)
    private readonly sessionBus: OAuthLoginSessionBus,
    @Inject(OAUTH_PROVIDER_RESOLVER)
    private readonly providers: OAuthProviderResolver,
    private readonly oauthInstrumentation: OAuthInstrumentation,
  ) {}

  async start(
    params: OAuthStartParams,
    _sink: OAuthSink,
  ): Promise<OAuthStartResult> {
    // State-machine guard — refuse to enqueue a job for an unknown
    // provider so a typo'd `piProviderId` fails fast at the API edge
    // rather than inside the worker.
    const provider = await this.providers.resolve(params.piProviderId);
    if (!provider) {
      throw new BadRequestException(
        `Unsupported OAuth provider: '${params.piProviderId}'`,
      );
    }

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

    // Write the initial pending record before enqueueing the job so a
    // follow-up `submitCode` or `getStatus` request routed to a different
    // pod sees the session as known. The 900-second TTL clock starts here.
    await this.writeDurable(sessionId, {
      id: sessionId,
      status: 'pending',
      expiresAt: expiresAt.toISOString(),
    });

    // Enqueue the durable BullMQ job. The worker ({@link OAuthLoginWorker})
    // takes over the `provider.login` invocation: it builds the
    // `AbortController`, subscribes to the manual-code channel, drives the
    // SDK callbacks, and journals every step onto the job so a freshly-
    // spawned worker can rehydrate mid-flow after a pod restart.
    await this.loginQueue.add(
      OAUTH_LOGIN_RUN_JOB,
      {
        sessionId,
        piProviderId: params.piProviderId,
        enterpriseUrl: params.enterpriseUrl,
        journal: { events: [] },
      },
      {
        jobId: sessionId,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    // The legacy in-process path returned the modality/URLs discovered by
    // the SDK's `onAuth` / `onDeviceCode` callback; with the worker model
    // the modality is determined asynchronously inside the worker and
    // journaled into the durable record. We surface a placeholder
    // `modality: 'authcode'` here so the `OAuthStartResult` shape stays
    // backwards-compatible — callers polling `getStatus` see the real
    // modality once the worker has processed the first SDK callback.
    return {
      sessionId,
      modality: 'authcode',
      expiresAt: expiresAt.toISOString(),
    };
  }

  async submitCode(sessionId: string, code: string): Promise<void> {
    const durable = await this.readDurable(sessionId);
    if (!durable) {
      throw new NotFoundException(`OAuth session '${sessionId}' not found`);
    }
    if (durable.status !== 'pending') {
      throw new BadRequestException(
        'This OAuth session is not awaiting a pasted code',
      );
    }
    // Cross-pod delivery: any pod may receive the `submitCode` HTTP
    // request; the worker that owns the in-flight `provider.login`
    // Promise has already subscribed to this session's channel via
    // `OAuthLoginWorker.subscribeToCodeChannel`, so the publish
    // lands on the right pod regardless of which one served the
    // HTTP request.
    await this.sessionBus.publishCode(sessionId, code);
  }

  async getStatus(sessionId: string): Promise<OAuthSessionStatus> {
    const durable = await this.readDurable(sessionId);
    if (!durable) {
      throw new NotFoundException(`OAuth session '${sessionId}' not found`);
    }
    if (
      durable.status === 'pending' &&
      new Date(durable.expiresAt) < new Date()
    ) {
      // The Redis TTL would have reaped the key on its own clock; here we
      // surface an explicit `expired` status before the TTL hits so callers
      // polling getStatus see the transition deterministically.
      await this.deleteDurable(sessionId);
      return { status: 'expired' };
    }
    if (
      durable.status === 'pending' &&
      new Date(durable.expiresAt) > new Date()
    ) {
      // Orphan detection: the durable Redis record exists with
      // `expiresAt` still in the future, but no live BullMQ job is
      // queued / active / delayed for this `sessionId`. That means the
      // worker that owned the in-flight `provider.login` Promise has
      // gone away (pod restart, scale-down, or a worker-rehydration
      // failure) and the login cannot make progress. The BullMQ
      // queue — not a per-pod `Map<sessionId, ...>` — is the source
      // of truth for "is there a live job"; every pod running this
      // service queries the queue, so a non-owning pod no longer
      // reads every live session as orphaned just because its local
      // map is empty (AC clarification on work item
      // `d8744e56-292b-45bf-9217-42418427891a`).
      const jobs = await this.loginQueue.getJobs([
        'active',
        'waiting',
        'delayed',
      ]);
      const hasLiveJob = jobs.some((job) => job.data.sessionId === sessionId);
      if (!hasLiveJob) {
        // Surface the failure explicitly with a recognisable error
        // message so callers do not poll indefinitely on a dead
        // session, then `DEL` the Redis key so the Redis memory is
        // freed immediately rather than waiting for the 900-second
        // TTL clock.
        const orphanMessage = 'OAuth session orphaned by pod restart';
        // Increment the `nexus_oauth_login_orphaned_total` Prometheus
        // counter BEFORE the `DEL` so the metric observes every
        // orphan-recovery transition (work item
        // `b19758d8-2448-472a-b2db-3856d3f6b4bc`, follow-up §3 of
        // `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`).
        //
        // The helper's non-throwing contract mirrors the `recordBackend*`
        // shape — a metrics-layer failure MUST NOT abort the
        // orphan-recovery path, which is load-bearing for the polling
        // caller. We also wrap the call site in a local
        // `try { ... } catch { /* swallow */ }` mirror: the helper
        // itself already swallows errors, but keeping the defensive
        // `try` at the call site matches the codebase's defensive style
        // for `recordBackend*` call sites so a synchronous throw from
        // the helper cannot break the orphan-recovery path even if
        // future refactors change the helper's swallowing contract.
        try {
          this.oauthInstrumentation.recordOAuthLoginOrphaned();
        } catch {
          // Swallow — the counter MUST not break the orphan-recovery
          // path. The non-throwing contract lives on the helper
          // (`apps/api/src/oauth/oauth-instrumentation.ts`); this
          // local mirror is the belt-and-braces guarantee that the
          // session still transitions to `failed` and `DEL`s the
          // durable key even if the helper's contract is ever
          // weakened by a future refactor.
        }
        // "Write exactly once" guard for `session_taken_over_at`: on the
        // first orphan-recovery transition the durable record carries no
        // timestamp yet, so we mint a fresh ISO-8601 value here; on any
        // subsequent orphan-recovery (e.g. a caller polling getStatus
        // after the durable record was rewritten but before its TTL
        // elapsed) the existing timestamp is preserved verbatim. See
        // `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`
        // follow-up §2 and work item `ffb22b91-6047-4e6d-a345-2ff537376b61`.
        const takenOverAt =
          durable.session_taken_over_at ?? new Date().toISOString();
        await this.writeDurable(sessionId, {
          ...durable,
          status: 'failed',
          error: orphanMessage,
          session_taken_over_at: takenOverAt,
        });
        await this.deleteDurable(sessionId);
        return {
          status: 'failed',
          error: orphanMessage,
          session_taken_over_at: takenOverAt,
        };
      }
    }
    return {
      status: durable.status,
      modality: durable.modality,
      error: durable.error,
    };
  }

  /**
   * Read the durable half of a session from Redis. Returns `undefined` when
   * the key is missing or has been reaped by TTL.
   */
  private async readDurable(
    sessionId: string,
  ): Promise<OAuthLoginSessionDurable | undefined> {
    const result = await this.sessionStore.get(sessionId);
    return result ?? undefined;
  }

  /**
   * Persist (or overwrite) the durable half with a refreshed 900-second TTL.
   * Each call resets the TTL clock so an actively-progressing session is
   * never reaped mid-flow.
   */
  private async writeDurable(
    sessionId: string,
    durable: OAuthLoginSessionDurable,
  ): Promise<void> {
    await this.sessionStore.put(sessionId, durable, SESSION_TTL_SECONDS);
  }

  /**
   * Delete the durable half. No-op when the key is already gone.
   */
  private async deleteDurable(sessionId: string): Promise<void> {
    await this.sessionStore.delete(sessionId);
  }

  /**
   * Read-modify-write the durable half with a status transition plus optional
   * field-level extras, refreshing the 900-second TTL on every call.
   */
  private async transitionDurable(
    sessionId: string,
    status: OAuthSessionStatusValue,
    extras: Partial<Omit<OAuthLoginSessionDurable, 'id' | 'status'>> = {},
  ): Promise<void> {
    const current = await this.readDurable(sessionId);
    if (!current) return;
    const next: OAuthLoginSessionDurable = {
      ...current,
      ...extras,
      status,
    };
    await this.writeDurable(sessionId, next);
  }

  /**
   * Persist a terminal `failed` transition. Retained for parity with
   * {@link transitionDurable}'s sibling transitions even though the
   * synchronous initiation-timeout handler that originally called it
   * has moved to the worker (see {@link OAuthLoginWorker}).
   */
  private async markTerminalFailure(
    sessionId: string,
    message: string,
  ): Promise<void> {
    await this.transitionDurable(sessionId, 'failed', { error: message });
  }
}
