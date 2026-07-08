import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type {
  OAuthCredentials,
  OAuthDeviceCodeInfo,
  OAuthLoginCallbacks,
} from '@earendil-works/pi-ai/oauth';
import {
  OAUTH_LOGIN_RUN_JOB,
  OAUTH_LOGIN_SESSION_JOB_QUEUE,
  type OAuthSessionState,
  type OAuthSessionStatusValue,
} from '@nexus/core/schemas/oauth';
import { OAuthInstrumentation } from './oauth-instrumentation';
import { OAuthLoginSessionStore } from './oauth-login-session.store';
import {
  OAUTH_LOGIN_SESSION_BUS,
  OAUTH_LOGIN_SESSION_STORE,
  OAUTH_PROVIDER_RESOLVER,
  type OAuthLoginSessionBus,
  type OAuthProviderResolver,
} from './oauth-login.types';
import type {
  OAuthLoginJobJournal,
  OAuthLoginJobPayload,
  OAuthLoginJournalEvent,
} from './oauth-login.worker.types';

const SESSION_TTL_SECONDS = 900;
const INITIATION_TIMEOUT_MS = 20_000;
const DEFAULT_DEVICE_INTERVAL_SECONDS = 5;
const DEVICE_CODE_OPTION_ID = 'device_code';
const ENTERPRISE_PROMPT = /enterprise|domain/i;

/**
 * BullMQ processor that takes over the per-session `provider.login`
 * invocation previously driven by the in-process
 * `OAuthLoginService.runLogin` helper (follow-up §1 of
 * `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`,
 * work item `d8744e56-292b-45bf-9217-42418427891a`).
 *
 * ## Purpose
 *
 * Replace the per-pod in-process `Map<sessionId, { AbortController,
 * resolveCode }>` field that previously lived on `OAuthLoginService`.
 * The producer (`OAuthLoginService.start`) enqueues a durable BullMQ
 * job on the {@link OAUTH_LOGIN_SESSION_JOB_QUEUE} queue and this
 * worker drives the `provider.login` Promise for that session. Every
 * SDK callback the worker observes is journaled onto
 * {@link Job.updateProgress} so a freshly-spawned worker (after a
 * crash, scale-down, or BullMQ stalled-job recovery) can rehydrate
 * mid-flow without losing the in-flight state.
 *
 * ## Rehydration strategy (WR-2, two-path)
 *
 *   1. **Terminal fast-path** — journal already records `connected` /
 *      `failed`. The job is a no-op; `process()` returns immediately.
 *   2. **Prior abort fast-path** — journal already records
 *      `abort_issued`. The worker acknowledges the abort in the
 *      durable store and returns without re-invoking `provider.login`.
 *   3. **Rehydration path** — journal records `auth_initiated` or
 *      `device_initiated` without a terminal event. The worker does
 *      NOT re-invoke `provider.login` (per WR-2); it subscribes to
 *      the code channel, races the manual-code delivery against the
 *      initiation timeout, and lets the timeout settle the durable
 *      half to `failed` if no further progress is possible. A
 *      pre-existing `code_delivered` journal event resolves the
 *      manual-code Promise immediately so the wait is bounded.
 *   4. **Fresh-start path** — empty journal or only non-terminal
 *      events. The worker subscribes to the code channel BEFORE
 *      invoking `provider.login` (publish-before-subscribe race
 *      guard) and drives the SDK callbacks to a terminal outcome.
 *
 * ## Producer/consumer contract
 *
 *   - Queue name: {@link OAUTH_LOGIN_SESSION_JOB_QUEUE} (`"oauth-login"`).
 *   - Job name: {@link OAUTH_LOGIN_RUN_JOB} (`"run"`). Anything else
 *     is logged at `debug` and returned as a no-op so an accidental
 *     `queue.add('something-else', ...)` does not crash the worker.
 *   - `attempts: 1` is set at the enqueue site (`OAuthLoginService.start`);
 *     the worker trusts the per-job options.
 *   - The journal lives on `Job.updateProgress`; `job.data` carries the
 *     initial payload (`sessionId`, `piProviderId`, `enterpriseUrl`)
 *     only. The worker reads `job.progress` for replay — the payload
 *     type deliberately omits any journal field, so the worker reads
 *     exclusively from `job.progress` for replay and writes via
 *     `job.updateProgress`.
 *
 * Mirrors `MemoryEvictionProcessor` / `MemoryDecayProcessor` for the
 * `WorkerHost` extension pattern, `@Processor` decorator placement,
 * constructor DI conventions, and `process(job)` dispatch shape.
 */
@Injectable()
@Processor(OAUTH_LOGIN_SESSION_JOB_QUEUE)
export class OAuthLoginWorker extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(OAuthLoginWorker.name);

  /**
   * Per-pod in-process map of session ids to the runtime primitives
   * that cannot live in Redis or the BullMQ payload: the per-session
   * `AbortController` and the manual-code Promise resolver. Indexed
   * by the same `sessionId` as the durable Redis record and the
   * BullMQ job's `sessionId` field.
   *
   * Lifecycle: entries are inserted at the top of `handleRunJob()`,
   * read by the SDK callbacks and the code-channel subscriber, and
   * deleted in the `finally` block (and again at `OnModuleDestroy`).
   */
  private readonly transient = new Map<
    string,
    { abortController: AbortController; resolveCode?: (code: string) => void }
  >();

  constructor(
    @Inject(OAUTH_LOGIN_SESSION_STORE)
    private readonly sessionStore: OAuthLoginSessionStore,
    @Inject(OAUTH_LOGIN_SESSION_BUS)
    private readonly sessionBus: OAuthLoginSessionBus,
    @Inject(OAUTH_PROVIDER_RESOLVER)
    private readonly providers: OAuthProviderResolver,
    private readonly oauthInstrumentation: OAuthInstrumentation,
  ) {
    super();
  }

  /**
   * Tear down the worker: abort every pending `AbortController` so any
   * in-flight `provider.login` Promise short-circuits, drain the
   * per-pod transient map, and let NestJS dispose the underlying
   * `Worker` (which `WorkerHost` owns).
   */
  onModuleDestroy(): void {
    if (this.transient.size === 0) {
      return;
    }
    for (const [sessionId, entry] of this.transient) {
      try {
        entry.abortController.abort();
      } catch (error) {
        this.logger.warn(
          `Failed to abort OAuth login session ${sessionId} during shutdown: ${(error as Error).message}`,
        );
      }
    }
    this.transient.clear();
  }

  /**
   * Dispatch the BullMQ job. Only {@link OAUTH_LOGIN_RUN_JOB} is
   * handled; anything else is logged at `debug` and returned as a
   * no-op so an accidental `queue.add('something-else', ...)` from an
   * admin tool does not crash the worker.
   */
  async process(job: Job<OAuthLoginJobPayload>): Promise<void> {
    if (job.name !== OAUTH_LOGIN_RUN_JOB) {
      this.logger.debug(
        `Ignoring unknown OAuth login session queue task: ${job.name}`,
      );
      return;
    }
    await this.handleRunJob(job);
  }

  /**
   * Drive a single `OAuthLoginJobPayload` to a terminal outcome.
   *
   * The body is intentionally flat — a small per-branch dispatch
   * over the two-path rehydration decision plus the fresh-start path.
   * Each branch owns its own callback wiring / timeout / mark-
   * terminal-failure flow so the failure-mode of one branch cannot
   * leak into another.
   */
  private async handleRunJob(job: Job<OAuthLoginJobPayload>): Promise<void> {
    const sessionId = job.data.sessionId;
    const journal = this.readJournal(job);

    // Terminal fast-path: the durable half has already settled.
    if (this.journalIsTerminal(journal)) {
      return;
    }

    const priorAbort = this.journalHasEvent(journal, 'abort_issued');
    const isRehydration = this.journalHasInitiated(journal);

    const abortController = new AbortController();
    if (priorAbort) {
      abortController.abort();
    }

    const { resolveManualCode, manualCode } = this.createManualCodeDeferred();
    this.transient.set(sessionId, {
      abortController,
      resolveCode: resolveManualCode,
    });

    try {
      if (priorAbort) {
        await this.handlePriorAbort(job, journal, sessionId);
        return;
      }
      if (isRehydration) {
        await this.handleRehydration(
          job,
          journal,
          sessionId,
          manualCode,
          abortController,
        );
        return;
      }
      await this.handleFreshStart(job, journal, sessionId, {
        abortController,
        manualCode,
        enterpriseUrl: job.data.enterpriseUrl,
      });
    } catch (error) {
      this.logger.error(
        `OAuth login session ${sessionId} worker run crashed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    } finally {
      this.transient.delete(sessionId);
    }
  }

  /**
   * Read the replay buffer from `Job.updateProgress`. The journal
   * lives on `job.progress`, never on `job.data` (per the worker's
   * transient-durability contract). A `null` / missing / malformed
   * progress field falls back to an empty journal so a cold-start
   * `process()` always has a valid array to mutate.
   */
  private readJournal(job: Job<OAuthLoginJobPayload>): OAuthLoginJobJournal {
    const progress = job.progress;
    if (
      progress !== null &&
      typeof progress === 'object' &&
      Array.isArray((progress as { events?: unknown }).events)
    ) {
      return progress as OAuthLoginJobJournal;
    }
    return { events: [] };
  }

  private journalIsTerminal(journal: OAuthLoginJobJournal): boolean {
    return journal.events.some(
      (event) => event.type === 'connected' || event.type === 'failed',
    );
  }

  private journalHasEvent(
    journal: OAuthLoginJobJournal,
    type: OAuthLoginJournalEvent['type'],
  ): boolean {
    return journal.events.some((event) => event.type === type);
  }

  private journalHasInitiated(journal: OAuthLoginJobJournal): boolean {
    return journal.events.some(
      (event) =>
        event.type === 'auth_initiated' || event.type === 'device_initiated',
    );
  }

  /**
   * Build the deferred manual-code Promise. The resolver is wired
   * into the bus subscribe callback below; the Promise itself is
   * passed to `OAuthLoginCallbacks.onManualCodeInput`.
   */
  private createManualCodeDeferred(): {
    resolveManualCode: (code: string) => void;
    manualCode: Promise<string>;
  } {
    let resolveManualCode: (code: string) => void = () => {
      // Defensive no-op so a never-resolved Promise never throws on
      // the SDK's `await` if the channel subscriber never fires.
    };
    const manualCode = new Promise<string>((resolve) => {
      resolveManualCode = resolve;
    });
    return { resolveManualCode, manualCode };
  }

  /**
   * Honor a prior `abort_issued` journal event. The durable half
   * is acknowledged in `failed` with an `aborted` error so callers
   * polling `getStatus` observe a deterministic terminal state.
   */
  private async handlePriorAbort(
    job: Job<OAuthLoginJobPayload>,
    journal: OAuthLoginJobJournal,
    sessionId: string,
  ): Promise<void> {
    await this.markTerminalFailure(
      job,
      journal,
      sessionId,
      'OAuth login aborted',
    );
  }

  /**
   * Rehydration path (WR-2): the journal records an initiation
   * event but no terminal outcome. The worker does NOT re-invoke
   * `provider.login`; it subscribes to the code channel, races the
   * manual-code delivery against the initiation timeout, and lets
   * the timeout settle the durable half on expiry. A pre-existing
   * `code_delivered` journal event resolves the deferred immediately
   * so the wait is bounded by the timeout alone.
   */
  private async handleRehydration(
    job: Job<OAuthLoginJobPayload>,
    journal: OAuthLoginJobJournal,
    sessionId: string,
    manualCode: Promise<string>,
    abortController: AbortController,
  ): Promise<void> {
    this.subscribeToCodeChannel(sessionId);
    const delivered = this.lastDeliveredCode(journal);
    if (delivered !== undefined) {
      const entry = this.transient.get(sessionId);
      entry?.resolveCode?.(delivered);
    }
    const { timeout, handle } = this.buildInitiationTimeout(
      sessionId,
      job,
      journal,
      abortController,
    );
    try {
      await Promise.race([manualCode, timeout]).catch(() => {
        // Initiation-timeout / abort rejection is the expected
        // terminal outcome on this branch.
      });
    } finally {
      clearTimeoutIfPresent(handle);
    }
  }

  /**
   * Fresh-start path: subscribe to the code channel (publish-before-
   * subscribe race guard), resolve the provider, build the SDK
   * callbacks, and drive `provider.login` to a terminal outcome.
   * On `connected` the worker transitions the durable half and
   * journals the event; on SDK throw it transitions to `failed`.
   */
  private async handleFreshStart(
    job: Job<OAuthLoginJobPayload>,
    journal: OAuthLoginJobJournal,
    sessionId: string,
    params: {
      abortController: AbortController;
      manualCode: Promise<string>;
      enterpriseUrl: string | undefined;
    },
  ): Promise<void> {
    // Publish-before-subscribe race guard: the bus subscribe is the
    // first yielding side effect on this branch so a `submitCode`
    // publish that lands on the very next tick is never lost.
    this.subscribeToCodeChannel(sessionId);

    const provider = await this.providers.resolve(job.data.piProviderId);
    if (!provider) {
      await this.markTerminalFailure(
        job,
        journal,
        sessionId,
        `Unsupported OAuth provider: '${job.data.piProviderId}'`,
      );
      return;
    }

    const callbacks = this.buildCallbacks({
      sessionId,
      job,
      journal,
      abortController: params.abortController,
      manualCode: params.manualCode,
      enterpriseUrl: params.enterpriseUrl,
    });

    const { timeout, handle } = this.buildInitiationTimeout(
      sessionId,
      job,
      journal,
      params.abortController,
    );

    try {
      const loginPromise: Promise<OAuthCredentials> = provider.login(callbacks);
      await Promise.race([loginPromise, timeout]);
      if (params.abortController.signal.aborted) {
        // The initiation timeout fired mid-flight. The timeout's
        // own handler already journaled `failed` and transitioned
        // the durable half; nothing more to do here.
        return;
      }
      // The manual-code arrived, the SDK exchanged the code for
      // tokens, and `provider.login` resolved with the minted
      // credentials. The credentials themselves are NOT journaled —
      // they only live in the SDK return value and the caller-
      // supplied sink (M3 will plumb the sink to the worker).
      this.appendJournalEvent(journal, {
        type: 'code_delivered',
        code: '<<pasted>>',
      });
      await job.updateProgress(journal);
      await this.markConnected(job, journal, sessionId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'OAuth login failed';
      await this.markTerminalFailure(job, journal, sessionId, message);
    } finally {
      clearTimeoutIfPresent(handle);
    }
  }

  /**
   * Subscribe to the cross-pod manual-code delivery channel and
   * route the first delivery into the per-pod deferred. Subsequent
   * publishes are no-ops (the SDK only awaits one code per session).
   */
  private subscribeToCodeChannel(sessionId: string): void {
    let resolved = false;
    this.sessionBus.subscribeToCode(sessionId, (code) => {
      if (resolved) {
        return;
      }
      resolved = true;
      const entry = this.transient.get(sessionId);
      entry?.resolveCode?.(code);
    });
  }

  /**
   * Return the last `code_delivered` event's code on a rehydrated
   * session, or `undefined` when the journal does not yet contain
   * one. Used by the rehydration path to bound the wait on a journal
   * that already recorded a code delivery but never reached a
   * terminal outcome.
   */
  private lastDeliveredCode(journal: OAuthLoginJobJournal): string | undefined {
    for (let index = journal.events.length - 1; index >= 0; index -= 1) {
      const event = journal.events[index];
      if (event !== undefined && event.type === 'code_delivered') {
        return event.code;
      }
    }
    return undefined;
  }

  /**
   * Build the {@link OAuthLoginCallbacks} passed to
   * `provider.login`. Every SDK callback journals its event via
   * `Job.updateProgress` so a rehydrated worker can replay the
   * SDK-side state machine end-to-end.
   */
  private buildCallbacks(params: {
    sessionId: string;
    job: Job<OAuthLoginJobPayload>;
    journal: OAuthLoginJobJournal;
    abortController: AbortController;
    manualCode: Promise<string>;
    enterpriseUrl: string | undefined;
  }): OAuthLoginCallbacks {
    const {
      sessionId,
      job,
      journal,
      abortController,
      manualCode,
      enterpriseUrl,
    } = params;
    return {
      onAuth: (info) => {
        const event: OAuthLoginJournalEvent = {
          type: 'auth_initiated',
          authorizeUrl: info.url,
          ...(info.instructions !== undefined
            ? { instructions: info.instructions }
            : {}),
        };
        this.appendJournalEvent(journal, event);
        void job.updateProgress(journal);
        void this.transitionDurable(sessionId, 'pending', {
          modality: 'authcode',
          authorizeUrl: info.url,
          ...(info.instructions !== undefined
            ? { instructions: info.instructions }
            : {}),
        });
      },
      onDeviceCode: (info: OAuthDeviceCodeInfo) => {
        const event: OAuthLoginJournalEvent = {
          type: 'device_initiated',
          userCode: info.userCode,
          verificationUri: info.verificationUri,
          intervalSeconds:
            info.intervalSeconds ?? DEFAULT_DEVICE_INTERVAL_SECONDS,
        };
        this.appendJournalEvent(journal, event);
        void job.updateProgress(journal);
        void this.transitionDurable(sessionId, 'pending', {
          modality: 'device',
          userCode: info.userCode,
          verificationUri: info.verificationUri,
          intervalSeconds:
            info.intervalSeconds ?? DEFAULT_DEVICE_INTERVAL_SECONDS,
        });
      },
      onManualCodeInput: () => manualCode,
      onPrompt: (prompt) => {
        if (ENTERPRISE_PROMPT.test(prompt.message)) {
          return Promise.resolve(enterpriseUrl ?? '');
        }
        return manualCode;
      },
      onSelect: (prompt) => {
        const deviceCode = prompt.options.find(
          (option) => option.id === DEVICE_CODE_OPTION_ID,
        );
        return Promise.resolve(deviceCode?.id ?? prompt.options[0]?.id);
      },
      onProgress: () => {
        // No-op progress. Future observability can route SDK
        // progress messages through `MetricsService`.
      },
      signal: abortController.signal,
    };
  }

  /**
   * Build the per-`process()` initiation-timeout infrastructure.
   * The countdown is reconstructed every time `process()` runs so
   * a rehydrated worker gets a fresh 20-second budget. On expiry
   * the timer aborts the `AbortController`, journals `failed`,
   * transitions the durable half, and rejects the timeout Promise
   * so the caller's `Promise.race` settles deterministically.
   */
  private buildInitiationTimeout(
    sessionId: string,
    job: Job<OAuthLoginJobPayload>,
    journal: OAuthLoginJobJournal,
    abortController: AbortController,
  ): {
    timeout: Promise<never>;
    handle: ReturnType<typeof setTimeout>;
  } {
    let handle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      handle = setTimeout(() => {
        abortController.abort();
        const message = 'Timed out waiting for the provider to respond';
        void this.transitionDurable(sessionId, 'failed', { error: message });
        this.appendJournalEvent(journal, { type: 'failed', message });
        void job.updateProgress(journal);
        reject(
          new Error('Timed out waiting for the OAuth provider to respond'),
        );
      }, INITIATION_TIMEOUT_MS);
      handle.unref?.();
    });
    if (handle === undefined) {
      // Defensive — TypeScript's narrowing does not cross the
      // `setTimeout` boundary, but the `Promise` constructor
      // always assigns the handle synchronously.
      throw new Error(
        'OAuth login worker failed to record the initiation-timeout handle',
      );
    }
    return { timeout, handle };
  }

  /**
   * `connected` terminal outcome. Appends the journal marker,
   * persists the durable Redis record's `status: 'connected'`.
   */
  private async markConnected(
    job: Job<OAuthLoginJobPayload>,
    journal: OAuthLoginJobJournal,
    sessionId: string,
  ): Promise<void> {
    this.appendJournalEvent(journal, { type: 'connected' });
    await job.updateProgress(journal);
    await this.transitionDurable(sessionId, 'connected');
  }

  /**
   * Terminal `failed` outcome. Appends the journal marker,
   * persists the durable Redis record's `status: 'failed'` with
   * the supplied error message. Used by the prior-abort branch,
   * the unsupported-provider branch, and the SDK-throw branch.
   *
   * A rehydration-time Redis write failure on this path is the
   * orphan-recovery funnel — `resolveOrphanRehydration` is invoked
   * so the `nexus_oauth_login_orphaned_total` counter observes the
   * orphaned session (per the AC continuity clarification).
   */
  private async markTerminalFailure(
    job: Job<OAuthLoginJobPayload>,
    journal: OAuthLoginJobJournal,
    sessionId: string,
    message: string,
  ): Promise<void> {
    this.appendJournalEvent(journal, { type: 'failed', message });
    try {
      await job.updateProgress(journal);
    } catch (error) {
      this.logger.warn(
        `Failed to persist failed journal for OAuth session ${sessionId}: ${(error as Error).message}`,
      );
      this.resolveOrphanRehydration(sessionId);
    }
    try {
      await this.transitionDurable(sessionId, 'failed', { error: message });
    } catch (error) {
      this.logger.warn(
        `Failed to transition OAuth session ${sessionId} to failed: ${(error as Error).message}`,
      );
      this.resolveOrphanRehydration(sessionId);
    }
  }

  /**
   * Defensive helper for the malformed-journal / Redis-write-failure
   * funnel on a rehydrated session. Routes through
   * `OAuthInstrumentation.recordOAuthLoginOrphaned()` so the
   * `nexus_oauth_login_orphaned_total` counter keeps continuity with
   * the legacy orphan-recovery path (per the AC continuity
   * clarification on work item `d8744e56-292b-45bf-9217-42418427891a`).
   *
   * Non-throwing — the helper's own swallow keeps the metric
   * failure from breaking the terminal-state transition.
   */
  private resolveOrphanRehydration(sessionId: string): void {
    this.logger.warn(
      `Recording OAuth login orphan for rehydrated session ${sessionId}`,
    );
    try {
      this.oauthInstrumentation.recordOAuthLoginOrphaned();
    } catch {
      // The helper already swallows its own errors; this local
      // mirror matches the `recordBackend*` defensive style so a
      // synchronous throw from the helper cannot break the
      // orphan-recovery path even if the helper's contract is
      // ever weakened by a future refactor.
    }
  }

  /**
   * Read-modify-write the durable Redis record with a status
   * transition plus optional field-level extras, refreshing the
   * 900-second TTL on every call. Mirrors the legacy
   * `OAuthLoginService.transitionDurable` helper so the worker
   * preserves the original session-state surface end-to-end.
   */
  private async transitionDurable(
    sessionId: string,
    status: OAuthSessionStatusValue,
    extras: Partial<Omit<OAuthSessionState, 'id' | 'status'>> = {},
  ): Promise<void> {
    const current = await this.sessionStore.get(sessionId);
    if (current === null) {
      // The durable key has been reaped or never existed. Nothing
      // to transition — return gracefully so the worker does not
      // crash on a stale rehydration.
      return;
    }
    const next: OAuthSessionState = {
      ...current,
      ...extras,
      status,
    };
    await this.sessionStore.put(sessionId, next, SESSION_TTL_SECONDS);
  }

  /**
   * Append a single event to the in-memory journal. The disk-side
   * `await job.updateProgress(journal)` is the caller's
   * responsibility — keeping the persistence call out of this
   * helper lets the caller batch multiple appends into a single
   * checkpoint write when natural (the SDK callback path appends
   * once per callback so the batching is unnecessary here).
   */
  private appendJournalEvent(
    journal: OAuthLoginJobJournal,
    event: OAuthLoginJournalEvent,
  ): void {
    journal.events.push(event);
  }
}

/**
 * Defensive helper — clear a `setTimeout` handle only when one was
 * recorded. Mirrors the legacy `OAuthLoginService.start()` `finally`
 * block. A stray timeout firing after the worker has settled is
 * harmless, but clearing the handle keeps the per-pod timer count
 * clean under load.
 */
function clearTimeoutIfPresent(
  handle: ReturnType<typeof setTimeout> | undefined,
): void {
  if (handle !== undefined) {
    clearTimeout(handle);
  }
}
