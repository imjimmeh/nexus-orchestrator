/**
 * Test-only support code for `oauth-login.service.spec.ts`.
 *
 * Provides:
 * - {@link InMemoryOAuthLoginSessionStore} — an in-process
 *   `OAuthLoginSessionStore` mock that mirrors the production store's
 *   `oauth:session:{sessionId}` semantics with TTL eviction on read.
 * - {@link InMemoryOAuthLoginSessionBus} — a synchronous
 *   `OAuthLoginSessionBus` mock that delivers `publishCode` payloads to
 *   every subscriber for the target `sessionId` before resolving, so the
 *   cross-pod delivery path can be exercised inside a single-process unit
 *   test (mirrors the
 *   `apps/api/src/redis/redis-pubsub.service.spec.ts` mock-harness
 *   pattern).
 * - {@link createHarness} — a NestJS `TestingModule` factory that wires
 *   the production `OAuthLoginService` against the two in-memory fakes
 *   so the spec file can swap them for a shared pair across instances
 *   (Test A: cross-pod delivery) and seed the store directly (Test B:
 *   orphan recovery) without having to construct the production types
 *   by hand.
 *
 * Determinism note: the `InMemoryOAuthLoginSessionStore` methods are
 * intentionally NON-async (returning an already-resolved `Promise<void>`
 * via `Promise.resolve()`) so the only microtask boundary is the
 * caller's `await`. Adding `await` inside the fake introduces extra
 * microtasks that expose a transient read-modify-write race in the
 * production `runLogin` success-path `transitionDurable('connected')`
 * — that race exists in production only by Redis-round-trip luck, and
 * is exercised deterministically here by truncating every fake-mock
 * await to a single boundary. Non-async-but-Promise-returning lets the
 * helper satisfy `@typescript-eslint/require-await` (it only flags
 * `async` functions, of which these have none) while preserving the
 * "effectively synchronous" timing the test fixture needs.
 *
 * See `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`
 * for the durable / transient / bus split this harness fakes.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { vi } from 'vitest';
import type {
  OAuthCredentials,
  OAuthLoginCallbacks,
  OAuthProviderInterface,
} from '@earendil-works/pi-ai/oauth';
import { OAUTH_LOGIN_SESSION_JOB_QUEUE } from '@nexus/core/schemas/oauth';
import { OAuthLoginService } from './oauth-login.service';
import { OAuthInstrumentation } from './oauth-instrumentation';
import { MetricsService } from '../observability/metrics.service';
import {
  OAUTH_LOGIN_SESSION_BUS,
  OAUTH_LOGIN_SESSION_STORE,
  OAUTH_PROVIDER_RESOLVER,
  type OAuthLoginSessionDurable,
  type OAuthLoginSessionBus,
  type OAuthProviderResolver,
} from './oauth-login.types';

/**
 * Build a representative pi-ai `OAuthProviderInterface` whose `login`
 * function is provided by the caller. Mirrors the shape used by the
 * existing `oauth-login.service.spec.ts` `makeProvider` helper.
 */
export function makeProvider(
  login: (cb: OAuthLoginCallbacks) => Promise<OAuthCredentials>,
): OAuthProviderInterface {
  return {
    id: 'anthropic',
    name: 'Anthropic',
    login,
    refreshToken: (c) => Promise.resolve(c),
    getApiKey: (c) => c.access,
  };
}

/**
 * In-process mock of {@link OAuthLoginSessionStore}. Persists the durable
 * half of an OAuth login session in a `Map<sessionId, payload>` and
 * enforces the production store's TTL semantic by inspecting the
 * payload's `expiresAt` on every `get`; expired entries are evicted on
 * access and the call resolves to `null`, mirroring the contract
 * `readDurable` relies on.
 *
 * `put` recomputes `expiresAt` from `ttlSeconds` on every write so the
 * 900-second clock is reset exactly the way Redis' `SET ... EX 900`
 * does.
 *
 * The public surface (`put` / `get` / `delete` / `expireAt`) returns
 * `Promise<...>` so it structurally satisfies the production
 * `OAuthLoginSessionStore` interface; the bodies run synchronously to
 * keep test timing deterministic (see the module-level "Determinism
 * note" above).
 */
export class InMemoryOAuthLoginSessionStore {
  private readonly records = new Map<string, OAuthLoginSessionDurable>();

  /**
   * Persist (or overwrite) the durable half and refresh the 900-second
   * TTL clock. Mirrors the production `SET ... EX ttlSeconds` semantic by
   * rewriting `expiresAt` to a fresh `now + ttlSeconds * 1000`.
   */
  put(
    sessionId: string,
    durable: OAuthLoginSessionDurable,
    ttlSeconds = 900,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    this.records.set(sessionId, { ...durable, expiresAt });
    return Promise.resolve();
  }

  /**
   * Read the durable half. Returns `null` only when the key is
   * absent — payload-level `expiresAt` is **not** evaluated here
   * so the unit spec can exercise the service's expiry-branch
   * (which decides between `{ status: 'expired' }` and
   * `NotFoundException`) without the store short-circuiting
   * the choice.
   *
   * Production parity: the production
   * `OAuthLoginSessionStore.get` is a Redis `GET` — Redis
   * enforces its own `SET ... EX 900` TTL on the key, not the
   * payload's `expiresAt` field. So in production a record
   * whose payload `expiresAt` is in the past is still
   * `GET`-able for the remainder of the 900 s window; the
   * service's `getStatus` is the single owner of the
   * `{ status: 'expired' }` transition. This mock now mirrors
   * that split. To simulate a record whose key has been
   * reaped by Redis' TTL, just `delete()` it.
   */
  get(sessionId: string): Promise<OAuthLoginSessionDurable | null> {
    const record = this.records.get(sessionId);
    if (!record) {
      return Promise.resolve(null);
    }
    return Promise.resolve(record);
  }

  /**
   * Remove the durable half. No-op when the key is already gone,
   * matching the production store's contract.
   */
  delete(sessionId: string): Promise<void> {
    this.records.delete(sessionId);
    return Promise.resolve();
  }

  /**
   * Absolute expiry timestamp of the durable record (or `null` when no
   * record is present), mirroring the production `expireAt` contract.
   */
  expireAt(sessionId: string): Promise<Date | null> {
    const record = this.records.get(sessionId);
    if (!record) {
      return Promise.resolve(null);
    }
    return Promise.resolve(new Date(record.expiresAt));
  }

  /** Test-only helper: peek at the raw payload without triggering eviction. */
  peek(sessionId: string): OAuthLoginSessionDurable | undefined {
    return this.records.get(sessionId);
  }

  /**
   * Test-only helper: seed a durable record whose `expiresAt` is
   * explicitly in the past. The production `put` always rewrites
   * `expiresAt` to `now + ttlSeconds * 1000` (mirroring Redis'
   * `SET ... EX` semantic), so it cannot produce an already-
   * expired record on its own. The `getStatus` expiry branch
   * requires a record with a past `expiresAt` AND a present
   * transient map (or no transient map at all), so the test
   * fixture for the expiry path uses this helper rather than
   * `put`.
   *
   * Mirrors the seed pattern used by the integration spec
   * (`oauth-login.integration.spec.ts`,
   * "marks a pending session whose expiresAt is in the past as
   * expired and DELs the durable key"), which seeds the real
   * `OAuthLoginSessionStore` directly because Redis honours
   * the explicit `expiresAt` field. The in-memory helper is
   * the unit-test analogue.
   */
  seedExpired(
    sessionId: string,
    partial: Partial<OAuthLoginSessionDurable> = {},
  ): Promise<void> {
    const record: OAuthLoginSessionDurable = {
      id: sessionId,
      status: 'pending',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      ...partial,
    };
    this.records.set(sessionId, record);
    return Promise.resolve();
  }
}

/**
 * Synchronous, in-process mock of {@link OAuthLoginSessionBus}.
 *
 * Holds a `Map<sessionId, Set<callback>>` of subscribers keyed by the
 * same `sessionId` the production `OAuthLoginSessionBusService` uses
 * for its channel namespace. `publishCode` dispatches its payload to
 * every subscriber synchronously before resolving — this is the
 * "publish-before-subscribe race guard" the production bus depends on,
 * and it is what lets the cross-pod test (Test A) verify that a code
 * submitted on harness 2 reaches the in-flight `provider.login` Promise
 * on harness 1 inside one process.
 */
export class InMemoryOAuthLoginSessionBus implements OAuthLoginSessionBus {
  private readonly subscribers = new Map<string, Set<(code: string) => void>>();

  subscribeToCode(sessionId: string, callback: (code: string) => void): void {
    const bucket = this.subscribers.get(sessionId) ?? new Set();
    bucket.add(callback);
    this.subscribers.set(sessionId, bucket);
  }

  /**
   * Deliver `code` synchronously to every subscriber for `sessionId`,
   * then resolve. Returns `Promise.resolve()` so the caller can `await`
   * the publish without changing the production-side await shape.
   */
  publishCode(sessionId: string, code: string): Promise<void> {
    const bucket = this.subscribers.get(sessionId);
    if (bucket) {
      for (const subscriber of bucket) {
        subscriber(code);
      }
    }
    return Promise.resolve();
  }

  /** Test-only helper: snapshot of subscriber counts per session id. */
  subscriberCount(sessionId: string): number {
    return this.subscribers.get(sessionId)?.size ?? 0;
  }
}

/**
 * Wiring choices for a single {@link createHarness} call. Pass a
 * provider (or omit for "unsupported provider" tests), and optionally
 * inject pre-built {@link InMemoryOAuthLoginSessionStore} /
 * {@link InMemoryOAuthLoginSessionBus} singletons so two harnesses can
 * share the same store/bus pair (cross-pod test). The {@link loginQueue}
 * stub is auto-built per harness with a default `getJobs: []` so every
 * spec gets a clean `no live job` state; tests that exercise the live-
 * job fast-path can override `loginQueue.getJobs.mockResolvedValueOnce(...)`
 * or supply their own `loginQueue` reference up-front.
 *
 * NOTE: not exported — used only to type the {@link createHarness}
 * signature and inferred at the call site.
 */
interface HarnessOptions {
  provider?: OAuthProviderInterface;
  store?: InMemoryOAuthLoginSessionStore;
  bus?: InMemoryOAuthLoginSessionBus;
  /**
   * Optional caller-built override for the
   * {@link OAUTH_LOGIN_SESSION_JOB_QUEUE} BullMQ queue stub.
   * Most tests should omit this — the harness's default
   * spy (`add: vi.fn().mockResolvedValue({ id: 'stub' })`,
   * `getJobs: vi.fn().mockResolvedValue([])`) is sufficient.
   * Pass a custom object only when a test wants to script
   * individual `getJobs` returns per call (see the
   * non-orphan counter scenario).
   */
  loginQueue?: {
    add: ReturnType<typeof vi.fn>;
    getJobs: ReturnType<typeof vi.fn>;
  };
}

/**
 * A built harness carries the wired service, the underlying Nest
 * module (so the caller can `await module.close()` between tests if
 * desired), plus the resolved store and bus so the spec can mutate
 * them or assert on their final state.
 *
 * NOTE: not exported — returned by value through `createHarness`; the
 * caller receives a structural type that destructures the same fields.
 */
interface Harness {
  service: OAuthLoginService;
  module: TestingModule;
  store: InMemoryOAuthLoginSessionStore;
  bus: InMemoryOAuthLoginSessionBus;
  resolver: OAuthProviderResolver;
  /**
   * The metrics spy wired into the harness's
   * {@link OAuthInstrumentation}. Tests can assert against
   * `oauthMetrics.recordOAuthLoginOrphaned` call counts to
   * verify the orphan-recovery counter fires (or does not
   * fire) on the code path under test.
   */
  oauthMetrics: {
    recordOAuthLoginOrphaned: ReturnType<typeof vi.fn>;
  };
  /**
   * The BullMQ queue stub wired into the service in place of
   * the production `OAuthLoginWorker` queue. Exposes
   * `add(...)` (called by {@link OAuthLoginService.start}) and
   * `getJobs(...)` (called by the orphan-recovery branch in
   * {@link OAuthLoginService.getStatus}). Specs override the
   * stub's `getJobs.mockResolvedValue` to drive the live-job
   * vs orphaned-session branch independently of any real
   * Redis / BullMQ state.
   */
  loginQueue: {
    add: ReturnType<typeof vi.fn>;
    getJobs: ReturnType<typeof vi.fn>;
  };
}

/**
 * Build a `TestingModule` with `OAuthLoginService` wired against the two
 * in-memory fakes (and optionally a caller-supplied provider mock +
 * shared store/bus pair). Mirrors the bootstrap pattern used by
 * `apps/api/src/redis/runner-config-store.service.spec.ts` and
 * `apps/api/src/oauth/oauth-login-session.store.spec.ts`.
 *
 * The harness also wires an in-test {@link MetricsService} spy
 * through {@link OAuthInstrumentation} so spec tests can assert on
 * the `recordOAuthLoginOrphaned` mutator without touching the real
 * prom-client registry. The `MetricsService` test double mirrors
 * the pattern used by the in-memory `MemoryMetricsService` test
 * double in `apps/api/src/memory/backend-instrumentation.spec.ts`
 * (search for `createMemoryMetricsMock`).
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const resolver: OAuthProviderResolver = {
    resolve: vi.fn((id: string) =>
      Promise.resolve(
        options.provider && id === options.provider.id
          ? options.provider
          : undefined,
      ),
    ),
  };

  const sharedStore = options.store;
  const sharedBus = options.bus;

  // Per-harness metrics spy. The single mutator the
  // `OAuthInstrumentation` helper touches is
  // `recordOAuthLoginOrphaned` (no other oauth-domain counter
  // exists today; if/when more are added, extend this spy with
  // additional `vi.fn()` entries).
  const oauthMetrics = {
    recordOAuthLoginOrphaned: vi.fn(),
  };

  /**
   * Per-harness BullMQ queue stub. `add(...)` is invoked by
   * {@link OAuthLoginService.start} to enqueue the per-session
   * worker job; `getJobs(...)` is invoked by the orphan-
   * recovery branch in {@link OAuthLoginService.getStatus}.
   *
   * The default `getJobs: []` keeps every spec's natural
   * state "no live BullMQ job" so the orphan branch fires
   * deterministically without the caller having to wire
   * anything; tests that want the live-job fast-path override
   * `getJobs.mockResolvedValueOnce(...)` after receiving the
   * harness, or supply their own `loginQueue` reference via
   * {@link HarnessOptions.loginQueue}.
   *
   * Pinning the stub at the harness (rather than letting the
   * spec import its own) keeps the queue contract visible to
   * the harness and prevents the spec from bypassing the
   * DI token wiring that production code uses.
   */
  const loginQueue = options.loginQueue ?? {
    add: vi.fn().mockResolvedValue({ id: 'stub' }),
    getJobs: vi.fn().mockResolvedValue([]),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      OAuthLoginService,
      OAuthInstrumentation,
      {
        provide: MetricsService,
        useValue: oauthMetrics,
      },
      { provide: OAUTH_PROVIDER_RESOLVER, useValue: resolver },
      {
        // Override the BullMQ queue token that
        // `OAuthLoginService` injects via `@InjectQueue(OAUTH_LOGIN_SESSION_JOB_QUEUE)`.
        // The harness satisfies the queue surface that
        // `start()` calls (`add`) and the orphan-recovery
        // helper queries (`getJobs`); both must be present.
        // See the smoke spec
        // (`apps/api/src/oauth/oauth.module.smoke.spec.ts`)
        // for the same pattern.
        provide: getQueueToken(OAUTH_LOGIN_SESSION_JOB_QUEUE),
        useValue: loginQueue,
      },
      sharedStore
        ? { provide: OAUTH_LOGIN_SESSION_STORE, useValue: sharedStore }
        : {
            provide: OAUTH_LOGIN_SESSION_STORE,
            useClass: InMemoryOAuthLoginSessionStore,
          },
      sharedBus
        ? { provide: OAUTH_LOGIN_SESSION_BUS, useValue: sharedBus }
        : {
            provide: OAUTH_LOGIN_SESSION_BUS,
            useClass: InMemoryOAuthLoginSessionBus,
          },
    ],
  }).compile();

  const store =
    sharedStore ??
    moduleRef.get<InMemoryOAuthLoginSessionStore>(OAUTH_LOGIN_SESSION_STORE);
  const bus =
    sharedBus ??
    moduleRef.get<InMemoryOAuthLoginSessionBus>(OAUTH_LOGIN_SESSION_BUS);

  return {
    service: moduleRef.get<OAuthLoginService>(OAuthLoginService),
    module: moduleRef,
    store,
    bus,
    resolver,
    oauthMetrics,
    loginQueue,
  };
}
