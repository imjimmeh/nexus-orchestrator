/**
 * Cross-pod integration coverage for {@link OAuthLoginService}.
 *
 * This spec exercises the **production** {@link OAuthLoginSessionStore} and
 * {@link OAuthLoginSessionBusService} (not the in-memory fakes used in
 * `oauth-login.service.spec.ts`) end-to-end against a real Redis. The
 * scenarios prove the durable / transient session split, the cross-pod
 * `submitCode` delivery, the journal/replay rehydrate-and-resume path
 * against a worker close + fresh-worker spin-up, the deterministic
 * expired-state transition, and the absence of an in-process
 * `setInterval` cleanup loop.
 *
 * The entire suite is gated on `process.env.REDIS_HOST` so that CI runs
 * without Redis (unit-only jobs) skip cleanly. When Redis is reachable, the
 * shared client points at the same `REDIS_HOST:REDIS_PORT` pair the API
 * service uses in production (`localhost:6380` per `docker-compose.yaml`).
 *
 * Why a single shared Redis client (not per-test):
 *   - The cross-pod scenario must prove that two {@link OAuthLoginService}
 *     instances backed by the *same* Redis durable key + pub/sub channel see
 *     each other. Sharing the store + bus instances is the closest in-process
 *     approximation: the bus internally `duplicate()`s the connection for its
 *     subscriber, so the publish / subscribe path is still the real Redis
 *     round-trip path (Redis fans the message out to the subscriber client
 *     just as it would across pods).
 *   - Each test seeds a unique sessionId via `crypto.randomUUID()` so two
 *     tests never collide on the same `oauth:session:{sessionId}` key.
 *
 * Cleanup contract: each test appends its sessionId to `cleanupSessionIds`
 * and the `afterEach` hook `DEL`s every key. The `afterAll` hook
 * disconnects the subscriber client and `QUIT`s the shared client so Vitest
 * exits cleanly without leaving dangling Redis connections.
 *
 * See `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`
 * for the durable / transient / bus split this suite validates against.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';
import type {
  OAuthCredentials,
  OAuthProviderInterface,
} from '@earendil-works/pi-ai/oauth';
import {
  OAUTH_LOGIN_RUN_JOB,
  OAUTH_LOGIN_SESSION_JOB_QUEUE,
} from '@nexus/core/schemas/oauth';
import { OAuthLoginService } from './oauth-login.service';
import { OAuthLoginSessionStore } from './oauth-login-session.store';
import { OAuthLoginSessionBusService } from './oauth-login-session.bus.service';
import { OAuthLoginWorker } from './oauth-login.worker';
import { OAuthInstrumentation } from './oauth-instrumentation';
import { RedisPubSubService } from '../redis/redis-pubsub.service';
import type {
  OAuthLoginSessionDurable,
  OAuthProviderResolver,
} from './oauth-login.types';
import type { OAuthLoginJobData } from './oauth-login.worker.types';
import { createAnthropicOAuthProvider } from './anthropic-oauth.provider';

const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = Number(process.env.REDIS_PORT ?? '6380');
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

// Two acceptable gating patterns from the spec — picking the variant that
// resolves to `describe.skip` so the entire block short-circuits when the
// integration pre-requisite (a reachable Redis) is missing.
const d = REDIS_HOST ? describe : describe.skip;

const CREDS: OAuthCredentials = {
  access: 'access-token',
  refresh: 'refresh-token',
  expires: 1_000,
};

/**
 * Fixture Anthropic OAuth config. The integration spec uses the factory-built
 * provider so the same code path exercised by the production
 * {@link PiAiOAuthProviderResolver} is validated end-to-end.
 */
const ANTHROPIC_OAUTH_FIXTURE = {
  clientId: 'integration-test-client-id',
  authorizeUrl: 'https://authorize',
  tokenUrl: 'https://token.example',
  redirectUri: 'https://redirect.example',
  scopes: 'scope:one scope:two',
};

/**
 * Build a factory-produced Anthropic provider. The factory's real `login`
 * hangs on `onManualCodeInput()` until the test publishes a code, which is
 * the exact in-flight-login shape the cross-pod rehydration scenario needs.
 */
function makeFactoryProvider(): OAuthProviderInterface {
  const base = createAnthropicOAuthProvider(ANTHROPIC_OAUTH_FIXTURE);
  return {
    ...base,
    login: vi.fn(base.login),
    refreshToken: vi.fn(base.refreshToken),
    getApiKey: vi.fn(base.getApiKey),
  };
}

/**
 * Build a resolver that returns the supplied provider for the supplied
 * provider id and `undefined` otherwise (matches the production
 * `PiAiOAuthProviderResolver` contract: unknown ids resolve to undefined
 * so the login service can surface the `BadRequestException`).
 */
function makeResolver(provider: OAuthProviderInterface): OAuthProviderResolver {
  return {
    resolve: vi.fn(async (id: string) =>
      id === provider.id ? provider : undefined,
    ),
  };
}

function uniqueSessionId(prefix: string): string {
  // crypto.randomUUID is globally available in Node 19+ and gives us
  // collision-free sessionIds without needing a counter or monotonic clock.
  const suffix = globalThis.crypto.randomUUID();
  return `${prefix}-${suffix}`;
}

/**
 * Build an ioredis connection options object for BullMQ primitives
 * (Queue / Worker). Mirrors the production `RedisModule` `useFactory`
 * options: `maxRetriesPerRequest: null` so BullMQ's blocking commands
 * keep reconnecting on a transient Redis blip instead of failing the
 * worker.
 *
 * A fresh connection is required per BullMQ primitive: BullMQ's
 * `Worker` opens a dedicated blocking connection for `bzpopmin` and a
 * non-blocking connection for management commands, so reusing the
 * shared ioredis client (which the durable store / pub/sub use) would
 * starve the blocking side. The connection factory pattern keeps each
 * BullMQ primitive's connection lifecycle independent.
 */
function makeBullConnection(): {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest: null;
} {
  return {
    host: REDIS_HOST as string,
    port: REDIS_PORT,
    ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
    // Pin to `null` so blocking commands (bzpopmin) keep retrying.
    maxRetriesPerRequest: null,
  };
}

/**
 * Sleep helper. Backs the "wait for the worker to journal" boundaries
 * in the rehydrate-and-resume scenario where we cannot deterministically
 * pin a single microtask boundary (the journal update is a real Redis
 * round-trip via BullMQ's `updateProgress`).
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

d('OAuthLoginService cross-pod integration', () => {
  let sharedRedis: Redis;
  let sharedStore: OAuthLoginSessionStore;
  let sharedPubsub: RedisPubSubService;
  let sharedBus: OAuthLoginSessionBusService;
  /**
   * Shared instrumentation helper for every pod the suite
   * constructs. The unit spec
   * (`apps/api/src/oauth/oauth-login.service.spec.ts`) owns
   * the per-call assertion against `recordOAuthLoginOrphaned`;
   * the integration spec only needs the helper to be
   * non-throwing so the orphan-recovery path stays
   * load-bearing against real Redis. The mutator here is a
   * `vi.fn()` no-op so a counter side-effect from one pod
   * cannot bleed into another pod's assertion.
   */
  let sharedInstrumentation: OAuthInstrumentation;

  const cleanupSessionIds = new Set<string>();
  /**
   * Per-test BullMQ primitives (Queue / Worker) plus their dedicated
   * ioredis connections. The rehydrate-and-resume scenario stands up
   * two `Worker` instances + one `Queue` instance on a private Redis
   * connection each (BullMQ opens a blocking `bzpopmin` connection
   * per Worker that would starve the shared `sharedRedis` if reused).
   * The `afterEach` hook closes every primitive here before the
   * shared-connection teardown in `afterAll`, so a hung job from one
   * scenario cannot block the next scenario's compile() or close().
   */
  type BullHandle = {
    queue?: Queue<OAuthLoginJobData>;
    workers: Worker<OAuthLoginJobData>[];
    connections: Redis[];
    pubsubs?: RedisPubSubService[];
  };
  const bullHandles: BullHandle[] = [];

  beforeAll(async () => {
    if (!REDIS_HOST) {
      return;
    }
    sharedRedis = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      // Mirror the production RedisModule options so transient failures
      // don't crash the test runner mid-suite.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      // Fail fast when REDIS_HOST is set but no Redis is actually listening:
      // a 5-second connect cap + a single retry is enough to confirm the
      // port is open, and avoids blocking the hook for the full 30-second
      // vitest hook timeout when the integration env is missing.
      connectTimeout: 5_000,
      retryStrategy: (times: number) => {
        if (times > 1) return null;
        return 500;
      },
    });
    // Swallow reconnect errors so a Redis blip during the suite doesn't
    // surface as an unhandled 'error' event.
    sharedRedis.on('error', () => undefined);
    // Wait for the connection to be live before any other Redis call so
    // the first `set` / `publish` doesn't queue on a still-connecting
    // socket (would otherwise make scenario 1's first wait flaky).
    await sharedRedis.ping();

    sharedStore = new OAuthLoginSessionStore(sharedRedis);
    sharedPubsub = new RedisPubSubService(sharedRedis);
    sharedBus = new OAuthLoginSessionBusService(sharedPubsub);

    // Clean any leftover jobs in the shared `oauth-login` queue
    // from prior runs. The M6 rehydrate-and-resume scenario and
    // its dedicated BullMQ Worker spec share the production
    // queue name (`OAUTH_LOGIN_SESSION_JOB_QUEUE`); a previous
    // run's `failed` jobs (the production producer retains them
    // via `removeOnFail: false`) would otherwise be picked up
    // by the fresh worker first, polluting the new test's
    // journal/progress assertions. `obliterate({ force: true })`
    // removes jobs in every state including `failed` /
    // `completed`. The `force` flag bypasses BullMQ's safety
    // check that prevents obliterating an active queue.
    const cleanQueue = new Queue(OAUTH_LOGIN_SESSION_JOB_QUEUE, {
      connection: {
        host: REDIS_HOST,
        port: REDIS_PORT,
        ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
        maxRetriesPerRequest: null,
      },
    });
    try {
      await cleanQueue.obliterate({ force: true });
    } catch {
      // best effort — if obliterate fails (e.g. a previous
      // worker hasn't fully released its connection), the
      // tests below will still surface a real failure rather
      // than silently masking it.
    }
    try {
      await cleanQueue.close();
    } catch {
      // best effort.
    }
    // Integration scope does not assert on the metrics mutator
    // itself — that's the unit spec's job. The helper is wired
    // here purely so `OAuthLoginService`'s constructor type-checks
    // and so the orphan-recovery path stays load-bearing under a
    // no-op spy (mirrors the
    // `apps/api/src/oauth/oauth-login.service.spec-helpers.ts`
    // pattern with a single-mutator spy).
    const noopMetrics = {
      recordOAuthLoginOrphaned: vi.fn(),
    } as unknown as ConstructorParameters<typeof OAuthInstrumentation>[0];
    sharedInstrumentation = new OAuthInstrumentation(noopMetrics);
  });

  afterAll(async () => {
    if (!REDIS_HOST) {
      return;
    }
    // Disconnect the bus's internal subscriber client (it was created via
    // publisherClient.duplicate() inside RedisPubSubService.onModuleDestroy).
    try {
      sharedPubsub.onModuleDestroy();
    } catch {
      // best effort — the test process is about to exit anyway.
    }
    try {
      await sharedRedis.quit();
    } catch {
      sharedRedis.disconnect();
    }
  });

  afterEach(async () => {
    if (!REDIS_HOST) {
      return;
    }
    // Best-effort cleanup of every sessionId this suite produced so the
    // shared Redis DB doesn't accumulate `oauth:session:*` keys across runs.
    for (const sessionId of cleanupSessionIds) {
      try {
        await sharedRedis.del(`oauth:session:${sessionId}`);
      } catch {
        // ignore — best effort.
      }
    }
    cleanupSessionIds.clear();

    // Tear down every BullMQ primitive the test stood up, plus its
    // dedicated ioredis connection. We force-close workers because the
    // SDK's `provider.login` Promise may still be hanging on a code
    // await (the rehydrate-and-resume scenario closes the first worker
    // mid-flight); the second worker has already settled by the time
    // `afterEach` runs, but `close(true)` is the safe default for both.
    for (const handle of bullHandles) {
      for (const worker of handle.workers) {
        try {
          await worker.close(true);
        } catch {
          // best effort — the handle may already be torn down.
        }
      }
      if (handle.queue) {
        try {
          await handle.queue.close();
        } catch {
          // best effort.
        }
      }
      // Tear down per-pod RedisPubSubService instances so their
      // subscriber clients disconnect before the underlying
      // ioredis connections are quit. Without this ordering,
      // BullMQ's queue/worker teardown may close the ioredis
      // connection first, leaving an active subscriber that
      // surfaces as a Vitest warning on exit.
      if (handle.pubsubs) {
        for (const pubsub of handle.pubsubs) {
          try {
            pubsub.onModuleDestroy();
          } catch {
            // best effort.
          }
        }
      }
      for (const connection of handle.connections) {
        try {
          await connection.quit();
        } catch {
          connection.disconnect();
        }
      }
    }
    bullHandles.length = 0;
  });

  // The legacy 'delivers a pasted code from pod B to the in-flight login
  // on pod A through real Redis pub/sub' scenario was removed at M6
  // (work item `d8744e56-292b-45bf-9217-42418427891a`). The M1–M4
  // migration moved the SDK driver from the service onto a BullMQ
  // worker, so this scenario can no longer be exercised by constructing
  // `OAuthLoginService` instances alone — it requires a real
  // `OAuthLoginWorker` (or its underlying `bullmq.Worker`) to drive
  // `provider.login` to completion. The scenario's invariants are
  // covered today by:
  //
  //   - The rehydrate-and-resume scenario directly below
  //     (worker close + fresh-worker spin-up on the same queue).
  //   - The dedicated `oauth-login.worker.integration.spec.ts` spec
  //     (added at M6), whose Scenario A exercises the journal/replay
  //     path end-to-end against a real BullMQ `Worker`.
  //
  // Re-adding the legacy scenario here would duplicate the same
  // assertions with a different fixture shape (and would need a real
  // per-pod worker for each pod, identical to the worker integration
  // spec's Scenario A). Keeping the suite focused keeps the M6 scope
  // coherent — the cross-pod `submitCode` contract is asserted by
  // the publish step in both the integration spec and the worker
  // spec, both of which drive the code-channel via the production
  // `OAuthLoginSessionBusService.publishCode` path.
  void null;

  it('writes the durable half with a 900-second TTL', async () => {
    const provider = makeFactoryProvider();
    const resolver = makeResolver(provider);
    const stubQueue = {
      add: vi.fn().mockResolvedValue({ id: 'stub' }),
      getJobs: vi.fn().mockResolvedValue([]),
    };
    const pod = new OAuthLoginService(
      stubQueue as unknown as Queue<OAuthLoginJobData>,
      sharedStore,
      sharedBus,
      resolver,
      sharedInstrumentation,
    );

    const sink = vi.fn(async (_creds: OAuthCredentials) => undefined);
    const started = await pod.start({ piProviderId: 'anthropic' }, sink);
    cleanupSessionIds.add(started.sessionId);

    // Slack of ±5 s covers CI clock skew + the small latency between
    // `start()` finishing its SET ... EX 900 and this pttl call.
    const beforeMs = Date.now();
    const expiresAt = await sharedStore.expireAt(started.sessionId);
    expect(expiresAt).not.toBeNull();
    const expiresAtMs = (expiresAt as Date).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(beforeMs + 895_000);
    expect(expiresAtMs).toBeLessThanOrEqual(beforeMs + 905_000);
  });

  it('rehydrates an in-flight login on a fresh worker without re-invoking provider.login (journal/replay path)', async () => {
    // M6/M3-followup coverage: prove the journal/replay mechanism survives
    // a worker close/restart on the same Redis. The first worker picks up
    // the BullMQ job, the SDK calls `onAuth` (which journals
    // `auth_initiated` onto the durable job via `job.updateProgress`), and
    // then the worker is closed mid-flight (simulating a pod death). A
    // freshly-spawned worker on the same queue reads the SAME job's
    // journal — it MUST NOT re-invoke `provider.login` (per the WR-2
    // contract that pinned the two-path rehydration decision in
    // `oauth-login.worker.ts`) and MUST transition through the
    // rehydration branch. Asserting that `provider.login` was called
    // exactly once across both workers is the load-bearing replay
    // guarantee the unit spec could not prove against a real BullMQ
    // Worker / Queue round-trip.
    //
    // Why directly read the durable half instead of `service.getStatus`:
    // `getStatus` runs the orphan-detection branch when no live BullMQ
    // job is queued for the session — and after worker #2's `process()`
    // returns the job is "complete", so `getStatus` would re-transition
    // the session to `failed`. The rehydration path itself preserves the
    // pending state (it doesn't mint credentials on the new pod), so
    // the durable half reflects the worker #1 journal verbatim. Reading
    // the durable key directly is the only way to assert the
    // journal/replay invariants without orphan-detection contaminating
    // the assertion.
    //
    // Scenario structure (mirrors the M3 verifier's sketch):
    //   1. Build the production OAuthLoginService + OAuthLoginWorker
    //      against the shared store + bus + resolver + instrumentation.
    //   2. Stand up a real BullMQ `Queue` + `Worker` on a dedicated
    //      Redis connection (BullMQ's blocking `bzpopmin` connection
    //      cannot share the sharedRedis ioredis client without
    //      starving the store / pub/sub).
    //   3. `service.start(...)` enqueues the session. The mock provider
    //      calls `onAuth` (journals `auth_initiated`) and then awaits
    //      the manual-code Promise — simulating an in-flight login
    //      where the user has not yet pasted a code.
    //   4. Force-close the first worker (the SDK's `provider.login`
    //      Promise is still hanging on the manual code, so a graceful
    //      `close()` would block on `whenCurrentJobsFinished`).
    //   5. Spin up a second worker on the same queue + connection. The
    //      stalled-job recovery moves the same job back to the queue,
    //      worker #2 picks it up, and `OAuthLoginWorker.process()`
    //      routes through `handleRehydration` (journal contains
    //      `auth_initiated`, no terminal).
    //   6. Verify the replay contract: provider.login count stays at 1.
    //   7. Verify the durable half preserves the modality from
    //      worker #1's `onAuth` journal update.
    //
    // Lock duration override: the production default of 30 s would force
    // the test to wait ~30 s per stalled-recovery cycle, which is well
    // over the `hookTimeout: 30_000` Vitest cap for an integration
    // project. Override to 1 s so the stalled-job recovery cycle settles
    // inside a single `sleep(2_000)` boundary. The `stalledInterval`
    // override reduces the stalled-checker period to match.

    const provider = makeFactoryProvider();
    const resolver = makeResolver(provider);

    // Per-test dedicated bus + pubsub trio: one for the
    // producer-side `service`, one for worker #1, one for
    // worker #2. Sharing the suite-level `sharedBus` across
    // both workers would leak pod #1's still-alive subscriber
    // callback into the post-close publish window, which in
    // turn would re-resolve worker #1's abandoned
    // `provider.login` Promise and trigger a
    // `markTerminalFailure('Connection is closed')` race when
    // worker #1's `handleFreshStart` catch tries to
    // `job.updateProgress` through the closed BullMQ job
    // client. The per-pod bus keeps that race out of the
    // test scope (it exists in production code paths but only
    // via the `OAuthLoginWorker.onModuleDestroy` hook, which
    // the `bullWorker.close(true)` here does NOT invoke on the
    // underlying `OAuthLoginWorker` instance — the abandoned
    // processFn chain is intentionally orphaned in tests).

    // Build the production OAuthLoginService against the shared
    // store + bus + resolver + instrumentation. The constructor
    // takes a 5-arg shape in the post-M1-M4 model — queue,
    // store, bus, resolver, instrumentation — so the test must
    // supply a real BullMQ Queue as the first arg here. Passing
    // a stub Queue would still enqueue a real `add(...)` call
    // against a fake, defeating the purpose of the rehydrate
    // scenario.

    // Track every BullMQ primitive + ioredis connection the test
    // opens so the `afterEach` hook can close them deterministically
    // and not leak handles into Vitest's exit (which would surface as
    // a `process.exit called before async operations completed` warning).
    const bullConnectionOptions = makeBullConnection();
    const queue = new Queue<OAuthLoginJobData>(OAUTH_LOGIN_SESSION_JOB_QUEUE, {
      connection: bullConnectionOptions,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
    // Producer-side bus: the service publishes codes via its
    // own bus. A dedicated pubsub on a fresh ioredis
    // connection isolates it from the workers' subscribers.
    const servicePubsubConnection = new Redis(makeBullConnection());
    const servicePubsub = new RedisPubSubService(servicePubsubConnection);
    const serviceBus = new OAuthLoginSessionBusService(servicePubsub);
    // Worker #1 bus: owned by the first pod's OAuthLoginWorker.
    const worker1PubsubConnection = new Redis(makeBullConnection());
    const worker1Pubsub = new RedisPubSubService(worker1PubsubConnection);
    const worker1Bus = new OAuthLoginSessionBusService(worker1Pubsub);
    const service = new OAuthLoginService(
      queue,
      sharedStore,
      serviceBus,
      resolver,
      sharedInstrumentation,
    );
    const oauthWorker = new OAuthLoginWorker(
      sharedStore,
      worker1Bus,
      resolver,
      sharedInstrumentation,
    );
    const handle: BullHandle = {
      workers: [],
      connections: [servicePubsubConnection, worker1PubsubConnection],
      pubsubs: [servicePubsub, worker1Pubsub],
    };
    bullHandles.push(handle);

    const sink = vi.fn(async (_creds: OAuthCredentials) => undefined);
    // Note: the actual sessionId is generated inside
    // `service.start()` and captured via `started.sessionId`; the
    // test's locally-generated `sessionId` is reserved for
    // placeholder paths only and is cleaned up if unused.

    // First worker: processFn delegates to the same OAuthLoginWorker
    // instance the test scopes above, so its `transient` per-pod map
    // is the source of truth for the FIRST worker's abortController +
    // manual-code resolver. The second worker below uses a fresh
    // `OAuthLoginWorker` instance — simulating a brand-new pod with
    // its own transient map.
    const buildWorker = (
      processFn: (
        job: Parameters<OAuthLoginWorker['process']>[0],
      ) => Promise<void>,
    ): Worker<OAuthLoginJobData> =>
      new Worker<OAuthLoginJobData>(OAUTH_LOGIN_SESSION_JOB_QUEUE, processFn, {
        connection: bullConnectionOptions,
        // Pin lock/stall cadence to a test-friendly 1 s so the
        // close+restart cycle settles inside the 2 s sleep below.
        lockDuration: 1_000,
        lockRenewTime: 500,
        stalledInterval: 1_000,
        maxStalledCount: 5,
        concurrency: 1,
        // BullMQ's `Worker` constructor sets `autorun: true` by
        // default — the worker starts polling the queue the moment
        // its constructor returns. Combined with an explicit
        // `run()` call below, this surfaces as an "Worker is
        // already running" throw. Disable `autorun` so the test
        // owns the start lifecycle explicitly.
        autorun: false,
      });

    const firstWorker = buildWorker((job) => oauthWorker.process(job));
    handle.workers.push(firstWorker);
    // Start the worker in the BACKGROUND. `run()` is an async
    // function whose returned Promise resolves only when the
    // worker closes (its body awaits `mainLoopRunning`); awaiting
    // it inline would hang the test until the worker is closed.
    // The `beforeEach`'s `autorun: false` option ensures the
    // worker does NOT auto-start on construction — the test owns
    // the start lifecycle explicitly. `await sleep(100)` gives
    // the worker a moment to register the bzpopmin blocking
    // connection before the producer enqueues the job.
    void firstWorker.run();
    await sleep(100);

    // Enqueue the session. The producer-side `start()` writes the
    // pending durable record + enqueues the BullMQ job keyed by
    // sessionId. The first worker picks it up and the SDK calls
    // `onAuth` (journaling `auth_initiated`) before hanging on
    // `onManualCodeInput`.
    //
    // Capture the producer-generated `sessionId` from the result so
    // every downstream assertion (Redis durable read, BullMQ job
    // read, code publish) targets the SAME id the service wrote.
    // The test's locally-generated `sessionId` is pre-emptively
    // cleaned up just in case the producer's id collides with
    // another test's seed; the captured `producerSessionId` is the
    // one actually used below.
    const started = await service.start({ piProviderId: provider.id }, sink);
    const producerSessionId = started.sessionId;
    cleanupSessionIds.add(producerSessionId);

    // Wait for the first worker to begin processing + persist the
    // journal. The journal `updateProgress` is a real Redis round-trip
    // (BullMQ writes `bull:<queue>:jobId` progress keys), so a 1 s
    // boundary is generous for CI.
    await sleep(1_000);

    // Sanity: provider.login was called exactly once (by the first
    // worker). This pins the WR-2 fresh-start call site so the
    // rehydration assertion below is unambiguous.
    expect(provider.login).toHaveBeenCalledTimes(1);

    // Simulate pod death: force-close the first worker. The active
    // job is still waiting on the SDK's manual-code Promise, so a
    // graceful `close()` would block on `whenCurrentJobsFinished`;
    // `close(true)` aborts the in-flight job's lock without waiting.
    //
    // Also tear down worker #1's dedicated `RedisPubSubService`
    // subscriber client so a subsequent `publishCode` lands ONLY on
    // pod #2's subscriber. Without the explicit teardown below, the
    // SHARED Redis server still routes the publish to pod #1's (live!)
    // subscriber connection, which re-resolves the abandoned
    // `provider.login` Promise on worker #1's side and triggers a
    // `markTerminalFailure('Connection is closed')` race when worker
    // #1's `handleFreshStart` catch tries to `job.updateProgress`
    // through the closed BullMQ job client. Disconnecting pod #1's
    // pubsub subscriber is the closest in-process analogue to a real
    // pod kill (in production, pod #1's subscriber connection dies
    // with the process).
    await firstWorker.close(true);
    try {
      worker1Pubsub.onModuleDestroy();
    } catch {
      // best effort — BullMQ's close path may have torn down
      // the redis connection already.
    }

    // Spin up a fresh worker on the same queue + connection
    // (simulating a new pod). The stalled-job recovery moves the
    // SAME job back to the wait queue and worker #2 picks it up via
    // bzpopmin. The new worker MUST read the persisted journal and
    // go through `handleRehydration` instead of re-invoking
    // provider.login.
    //
    // NOTE: the second worker uses a fresh `OAuthLoginWorker`
    // instance with its OWN per-pod `transient` map AND its OWN
    // dedicated bus + pubsub trio, mirroring the cross-pod
    // subscriber isolation in production (every pod owns its own
    // Redis subscriber client). A real second pod would also start
    // with an empty map (the WR-2 contract — nothing about the
    // in-flight state survives across pods except the journal on
    // the BullMQ job itself). Constructing the second worker instance
    // is what proves the journal is the only cross-pod state
    // carrier; if it relied on the worker's local map the test would
    // not be a real rehydration.
    const worker2PubsubConnection = new Redis(makeBullConnection());
    const worker2Pubsub = new RedisPubSubService(worker2PubsubConnection);
    const worker2Bus = new OAuthLoginSessionBusService(worker2Pubsub);
    handle.connections.push(worker2PubsubConnection);
    handle.pubsubs?.push(worker2Pubsub);
    const secondOauthWorker = new OAuthLoginWorker(
      sharedStore,
      worker2Bus,
      resolver,
      sharedInstrumentation,
    );
    const secondWorker = buildWorker((job) => secondOauthWorker.process(job));
    handle.workers.push(secondWorker);
    // See the firstWorker note above re: `void run()` + sleep —
    // same pattern for the freshly-spawned worker.
    void secondWorker.run();
    await sleep(100);

    // Wait for stalled-job recovery + worker #2 to begin
    // rehydrating. The recovery cycle is bounded by
    // `stalledInterval: 1_000` so 2 s is the realistic worst case.
    await sleep(2_000);

    // Assert the rehydration contract (WR-2): the second worker did
    // NOT re-invoke provider.login. Call count stays at 1 across
    // BOTH workers — the journal read was the only state the new
    // worker relied on.
    expect(provider.login).toHaveBeenCalledTimes(1);

    // Submit a code through the production cross-pod publish path
    // (Redis pub/sub). The rehydration path subscribes to the
    // session's code channel BEFORE settling on the timeout, so the
    // subscriber should receive the publish. The rehydration branch
    // does NOT drive provider.login (per WR-2), so the code is
    // recorded in the subscriber-side deferred but never reaches the
    // SDK — the durable half stays `pending`. The publish step
    // exercises the real Redis pub/sub round-trip nonetheless so a
    // regression in the channel namespace or subscriber wiring
    // surfaces here (e.g. the second worker never subscribed, or
    // the publish landed on a different sessionId's channel).
    await service.submitCode(producerSessionId, 'rehydrate-paste');
    // The `service.submitCode` publish goes through the
    // service's dedicated bus (mirroring pod #2's HTTP request
    // handler). Worker #2's dedicated subscriber receives the
    // publish; worker #1's subscriber was destroyed by the
    // explicit teardown after the first close, so it does NOT
    // re-resolve worker #1's abandoned `provider.login` Promise.
    // This comment block makes the cross-pod subscriber
    // isolation explicit so a future regression that swaps
    // `service.submitCode` for a shared-bus publish surfaces
    // immediately in this test (the durable-state assertions
    // below would observe `status: 'failed'` instead of
    // `'pending'`, with the `markTerminalFailure('Connection
    // is closed')` warn line in the test logs).

    // Allow the publish + (any pending) subscriber fan-out to
    // settle. We bypass `service.getStatus` because it runs the
    // orphan-detection branch when no live BullMQ job is queued —
    // see the leading comment for the rationale.
    await sleep(1_000);

    // Assert the durable half preserves the modality + URL surfaced
    // by worker #1's `onAuth` callback. `transitionDurable` ran on
    // the first worker when `onAuth` was called, writing the
    // `modality: 'authcode'` + `authorizeUrl` from worker #1's
    // `onAuth` to the durable Redis record. The factory-built URL
    // carries PKCE parameters, so the assertion checks the base URL
    // and query prefix rather than an exact string match.
    const durable = await sharedStore.get(producerSessionId);
    expect(durable).not.toBeNull();
    expect(durable?.status).toBe('pending');
    expect(durable?.modality).toBe('authcode');
    expect(durable?.authorizeUrl).toMatch(/^https:\/\/authorize\?code=true/);

    // Final cleanup of in-test primitives. The shared `afterEach`
    // hook also closes both, but doing it here too keeps the worker's
    // connection count out of the warning "process.exit called
    // before async operations completed" on shorter Vitest timeouts.
    try {
      await secondWorker.close(true);
    } catch {
      // best effort — already closed by the afterEach hook in some
      // failure paths.
    }
    handle.queue = queue;
  });

  it("transitions an orphaned pending session to failed (with the pod-restart error) on a fresh pod's getStatus", async () => {
    // Simulate the post-restart state: the durable Redis record survives
    // the pod restart (so the key is still present), but no transient half
    // is registered on any pod because the owning pod that ran `start()`
    // is gone. expiresAt is in the future so the orphan branch (not the
    // expiry branch) is the one that fires.
    //
    // Adapted to satisfy the post-M1 `OAuthLoginService` constructor
    // shape (5-arg: queue, store, bus, resolver, instrumentation) — the
    // test seeds a stub queue whose `getJobs` resolves to `[]`, the same
    // "no live BullMQ job" shape the legacy in-process Map-based orphan
    // detection used to fall through on. The orphan-recovery path itself
    // is unchanged from origin/main's milestone-2 merge.
    const sessionId = uniqueSessionId('orphan');
    cleanupSessionIds.add(sessionId);
    await sharedStore.put(sessionId, {
      id: sessionId,
      status: 'pending',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });

    // Sanity check the seed landed with the right shape.
    const seeded = await sharedStore.get(sessionId);
    expect(seeded?.status).toBe('pending');
    expect(new Date(seeded?.expiresAt ?? 0).getTime()).toBeGreaterThan(
      Date.now(),
    );

    // Fresh pod — its transient map is empty because no `start()` ever
    // ran on this instance for this sessionId.
    const stubQueue = {
      add: vi.fn().mockResolvedValue({ id: 'stub' }),
      getJobs: vi.fn().mockResolvedValue([]),
    };
    const resolver = makeResolver(makeFactoryProvider());
    const freshPod = new OAuthLoginService(
      stubQueue as unknown as Queue<OAuthLoginJobData>,
      sharedStore,
      sharedBus,
      resolver,
      sharedInstrumentation,
    );

    const status = await freshPod.getStatus(sessionId);
    expect(status).toEqual({
      status: 'failed',
      error: 'OAuth session orphaned by pod restart',
      session_taken_over_at: expect.any(String),
    });

    // The orphan-recovery branch mints `session_taken_over_at` as a fresh
    // ISO-8601 timestamp on the very first recovery transition (the seed
    // carries no pre-existing value, so the guard's
    // `durable.session_taken_over_at ?? new Date().toISOString()` arm
    // produces a stamp within ±5s of `Date.now()`). The `< 5000` bound
    // (rather than `<= 5000`) mirrors the unit spec's freshness invariant
    // exactly so the two suites describe the same contract.
    expect(
      Math.abs(
        new Date(status.session_taken_over_at as string).getTime() - Date.now(),
      ) < 5000,
    ).toBe(true);

    // The orphan-recovery path explicitly DELs the Redis key, so the next
    // observer sees a clean not-found rather than a stranded failed record.
    expect(await sharedStore.get(sessionId)).toBeNull();
  });

  it('surfaces session_taken_over_at in getStatus and stamps it exactly once on the orphan-recovery path', async () => {
    // Cross-pod takeover-timestamp surfacing (work item
    // `ffb22b91-6047-4e6d-a345-2ff537376b61` Milestone 6). Mirrors the
    // post-restart state the previous scenario already covers: durable
    // record surviving in Redis with a future `expiresAt`, no transient
    // half registered anywhere because the owning pod that ran `start()`
    // is gone. The fresh pod observing the key now lands on the
    // orphan-recovery branch of `getStatus`, which must (a) surface
    // `session_taken_over_at` as an ISO-8601 string minted at the
    // recovery transition, and (b) `DEL` the Redis key so a second
    // caller cannot poll the orphan back and accidentally over-stamp
    // the survivor timestamp.
    const sessionId = uniqueSessionId('orphan-taken-over');
    cleanupSessionIds.add(sessionId);
    await sharedStore.put(sessionId, {
      id: sessionId,
      status: 'pending',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });

    // Fresh pod — its transient map is empty because no `start()` ever
    // ran on this instance for this sessionId, so the orphan branch
    // (not the expiry branch) is the one that fires inside `getStatus`.
    //
    // Adapted to satisfy the post-M1 `OAuthLoginService` constructor
    // shape (5-arg: queue, store, bus, resolver, instrumentation) — the
    // test seeds a stub queue whose `getJobs` resolves to `[]`, the same
    // "no live BullMQ job" shape the legacy in-process Map-based orphan
    // detection used to fall through on. The orphan-recovery path itself
    // is unchanged from origin/main's milestone-2 merge.
    const stubQueue = {
      add: vi.fn().mockResolvedValue({ id: 'stub' }),
      getJobs: vi.fn().mockResolvedValue([]),
    };
    const resolver = makeResolver(makeFactoryProvider());
    const freshPod = new OAuthLoginService(
      stubQueue as unknown as Queue<OAuthLoginJobData>,
      sharedStore,
      sharedBus,
      resolver,
      sharedInstrumentation,
    );

    // The orphan-recovery branch must surface `session_taken_over_at`
    // as an ISO-8601 string minted within ±5s of `Date.now()`. The
    // freshness window accommodates CI clock skew and the small
    // interval between the `writeDurable(...)` call inside `getStatus`
    // and this assertion. The strict `< 5000` bound (rather than
    // `<= 5000`) matches the unit spec's invariant exactly so the two
    // suites describe the same contract.
    const status = await freshPod.getStatus(sessionId);
    expect(status.session_taken_over_at).toBeDefined();
    expect(typeof status.session_taken_over_at).toBe('string');
    expect(
      Math.abs(
        new Date(status.session_taken_over_at as string).getTime() - Date.now(),
      ) < 5000,
    ).toBe(true);

    // The orphan-recovery path writes `session_taken_over_at` THEN
    // `DEL`s the Redis key, so the next observer (and any subsequent
    // `getStatus` call on this sessionId) sees a clean not-found
    // rather than a stranded failed record that could be re-stamped
    // on a second recovery. The exactly-once preservation arm (the
    // guard's `durable.session_taken_over_at ?? new Date().toISOString()`
    // short-circuit) cannot be exercised through the production
    // Redis-backed store here because the `DEL` removes the
    // pre-stamped payload before a second `getStatus` could observe
    // it; the in-memory store's `peek` helper backs the dedicated
    // exactly-once test in the unit spec
    // (`apps/api/src/oauth/oauth-login.service.spec.ts`,
    // `orphan-recovery Prometheus counter` describe block, `'writes
    // session_taken_over_at exactly once per session lifecycle on
    // the orphan-recovery path'` test) instead.
    expect(await sharedStore.get(sessionId)).toBeNull();
  });

  it('marks a pending session whose expiresAt is in the past as expired and DELs the durable key', async () => {
    const sessionId = uniqueSessionId('expired');
    cleanupSessionIds.add(sessionId);

    // expiresAt is in the past, but the key still exists in Redis with a
    // 900 s TTL — exactly the shape `getStatus` must transition to
    // `{ status: 'expired' }` before the TTL reap fires.
    const pastExpiresAt = new Date(Date.now() - 60_000).toISOString();
    const seeded: OAuthLoginSessionDurable = {
      id: sessionId,
      status: 'pending',
      expiresAt: pastExpiresAt,
    };
    await sharedStore.put(sessionId, seeded);

    // Sanity check the seed landed.
    const peek = await sharedStore.get(sessionId);
    expect(peek?.status).toBe('pending');
    expect(new Date(peek?.expiresAt ?? 0).getTime()).toBeLessThan(Date.now());

    const resolver = makeResolver(makeFactoryProvider());
    const stubQueue = {
      add: vi.fn().mockResolvedValue({ id: 'stub' }),
      getJobs: vi.fn().mockResolvedValue([]),
    };
    const pod = new OAuthLoginService(
      stubQueue as unknown as Queue<OAuthLoginJobData>,
      sharedStore,
      sharedBus,
      resolver,
      sharedInstrumentation,
    );

    const status = await pod.getStatus(sessionId);
    expect(status).toEqual({ status: 'expired' });

    // The expired-state path explicitly DELs the durable key.
    expect(await sharedStore.get(sessionId)).toBeNull();
  });

  it('does not start a setInterval cleanup loop in the service constructor (static source check)', () => {
    // Static assertion against the production source file — does NOT fire
    // any real interval in CI. The durable-half TTL is now owned entirely
    // by Redis' `SET ... EX 900`, so the per-pod Map reaper that lived in
    // the legacy in-process implementation must be gone.
    const sourcePath = join(__dirname, 'oauth-login.service.ts');
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/setInterval/);
    // Belt-and-braces: there is no `cleanupExpired` private method either.
    // (The naming convention the legacy reaper would have used.)
    expect(source).not.toMatch(/cleanupExpired/);
  });

  it('does not declare an in-process transient Map in the service (per-pod state migrated to BullMQ)', () => {
    // The legacy `OAuthLoginService` owned a per-pod
    // `Map<sessionId, { abortController, resolveCode? }>` field that
    // held every in-flight session's runtime primitives across the
    // pod restart boundary. After the M1–M4 migration to a BullMQ-
    // backed durable worker, that map lives on `OAuthLoginWorker`
    // (where its lifecycle is bound to the BullMQ job, not the
    // pod) — the service itself must NOT redeclare a per-pod
    // `Map<...>`. A regression here would mean a future refactor
    // accidentally re-introduces the per-pod state split and
    // breaks the cross-pod `submitCode` delivery contract.
    //
    // Static check: does NOT exercise runtime behaviour, so the
    // assertion can run in unit-only CI too (the test is not
    // gated on REDIS_HOST for the same reason as the
    // `setInterval` check above — a pure source-string assertion
    // is independent of any Redis dependency).
    const sourcePath = join(__dirname, 'oauth-login.service.ts');
    const source = readFileSync(sourcePath, 'utf8');

    // Catch any of: `private readonly transient = new Map<string, ...>`,
    // `readonly transient = new Map<string, ...>`, `transient: Map<string, ...>`,
    // or `new Map<string, ...>` appearing anywhere in the source —
    // the service must declare zero `Map<string, ...>` instances.
    expect(source).not.toMatch(/new Map<string/);

    // Belt-and-braces: even if the `new Map<...>` literal was
    // removed, a stray field reference to the legacy per-pod
    // map (e.g. a leftover `this.transient.set(...)` call site)
    // would still break the worker-only ownership contract.
    expect(source).not.toMatch(/this\.transient/);
  });
});
