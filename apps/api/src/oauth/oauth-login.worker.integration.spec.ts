/**
 * BullMQ-level integration coverage for {@link OAuthLoginWorker}.
 *
 * Work item: `d8744e56-292b-45bf-9217-42418427891a` (M6).
 *
 * This spec complements the unit spec
 * (`apps/api/src/oauth/oauth-login.worker.spec.ts`) and the
 * service-level cross-pod spec
 * (`apps/api/src/oauth/oauth-login.integration.spec.ts`) by exercising
 * the worker's {@link WorkerHost.process} entry point through a real
 * `bullmq.Worker` (`new Worker(queueName, processor, opts)`) — exactly
 * the call shape NestJS's `BullModule` uses at runtime. The unit spec
 * constructs `OAuthLoginWorker` directly and calls `process(job)` with
 * a hand-built `Job`-shaped literal; this spec instead wires a real
 * BullMQ `Worker` against the same production
 * {@link OAuthLoginSessionStore} /
 * {@link OAuthLoginSessionBusService} + a real `Queue`, so the
 * journal/replay path (the WR-2 rehydration contract) is exercised
 * against a real `Job.updateProgress` round-trip and a real Redis
 * pub/sub round-trip.
 *
 * The full rehydrate-and-resume scenario (worker close + fresh-worker
 * spin-up on the same queue + Redis) also lives in
 * `oauth-login.integration.spec.ts`. The two specs share the same
 * scenario shape but diverge on fixture ownership: the cross-pod
 * spec owns the SHARED Redis store/bus wired once in `beforeAll` for
 * sibling scenarios, while THIS spec keeps its own dedicated
 * fixtures inside `beforeEach` so a single test failure cannot
 * poison the shared state used by sibling tests.
 *
 * ## Gating
 *
 * The entire suite is gated on `process.env.REDIS_HOST` so that CI
 * jobs without Redis (unit-only runs) skip cleanly via `it.skip`. The
 * `beforeAll` and `beforeEach` hooks also short-circuit on the same
 * gate so the dedicated ioredis connections are only opened when a
 * test will actually run against real Redis.
 *
 * ## Cleanup contract
 *
 * Each test tracks every BullMQ primitive (Queue / Worker) and its
 * dedicated ioredis connection in a `BullHandle` struct; `afterEach`
 * force-closes every worker (the SDK's `provider.login` may still be
 * hanging on a code await), `quit()`s the connections, and closes
 * the Queue. The `afterAll` hook `QUIT`s the shared Redis client
 * and disconnects the `RedisPubSubService`'s subscriber so Vitest
 * exits cleanly without leaving dangling handles.
 */
import { randomUUID } from 'crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
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
import { OAuthLoginSessionStore } from './oauth-login-session.store';
import { OAuthLoginSessionBusService } from './oauth-login-session.bus.service';
import { RedisPubSubService } from '../redis/redis-pubsub.service';
import { OAuthLoginWorker } from './oauth-login.worker';
import type {
  OAuthLoginJobData,
  OAuthLoginJobPayload,
} from './oauth-login.worker.types';
import type { OAuthProviderResolver } from './oauth-login.types';
import { OAuthInstrumentation } from './oauth-instrumentation';
import type { MetricsService } from '../observability/metrics.service';
import { createAnthropicOAuthProvider } from './anthropic-oauth.provider';

const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = Number(process.env.REDIS_PORT ?? '6380');
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

/**
 * Two-arg gating pattern mirrors the production cross-pod spec: the
 * `itIfRedis` helper resolves to a real `it` only when `REDIS_HOST`
 * is set, so each individual test case — not just the enclosing
 * `describe` — short-circuits to `it.skip` in unit-only CI.
 */
const itIfRedis = REDIS_HOST ? it : it.skip;

const CREDS: OAuthCredentials = {
  access: 'access-token',
  refresh: 'refresh-token',
  expires: 1_000,
};

/**
 * Fixture Anthropic OAuth config. The integration spec uses the
 * factory-built provider so the same code path exercised by the
 * production {@link PiAiOAuthProviderResolver} is validated end-to-end.
 */
const ANTHROPIC_OAUTH_FIXTURE = {
  clientId: 'worker-int-client-id',
  authorizeUrl: 'https://authorize-worker-int',
  tokenUrl: 'https://token-worker-int.example',
  redirectUri: 'https://redirect-worker-int.example',
  scopes: 'scope:one scope:two',
};

/**
 * Factory-built Anthropic provider whose `login` is wrapped in a
 * vi.fn so call-count assertions remain possible. The factory's
 * real implementation hangs on manual-code input until the test
 * publishes a code, matching the in-flight-login scenario this
 * integration spec exercises.
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
 * Build a resolver that returns the supplied provider for the
 * supplied id and `undefined` otherwise (matches the production
 * `PiAiOAuthProviderResolver` contract — unknown ids resolve to
 * `undefined`).
 */
function makeResolver(provider: OAuthProviderInterface): OAuthProviderResolver {
  return {
    resolve: vi.fn(async (id: string) =>
      id === provider.id ? provider : undefined,
    ),
  };
}

/**
 * Convenience: `sleep(ms)` boundary used to back the real-Redis
 * journal + pub/sub round-trips. We cannot pin a single microtask
 * for the journal write (it's a real BullMQ `updateProgress` Redis
 * round trip) and for the pub/sub publish/subscribe fan-out (it's a
 * real `PUBLISH` round trip), so a short timeout boundary is the
 * only deterministic synchronization mechanism available.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the `defaultJobOptions` shape used by
 * `OAuthLoginService.start()`. Pinned in one place so the worker
 * spec stays consistent with the production producer even if the
 * defaults are tuned in a future revision.
 */
function defaultJobOptions() {
  return {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: false,
  };
}

/**
 * Build a fresh BullMQ-friendly `ConnectionOptions` object
 * mirroring the production `RedisModule` `useFactory` settings. A
 * fresh connection per BullMQ primitive is required because
 * BullMQ's `Worker` opens a dedicated blocking `bzpopmin`
 * connection that would starve the shared ioredis client.
 * Storing the options alongside the connection lifecycle is the
 * standard Vitest pattern for BullMQ integration specs.
 */
function makeBullConnection() {
  if (!REDIS_HOST) {
    throw new Error(
      'makeBullConnection requires REDIS_HOST — caller must guard with itIfRedis',
    );
  }
  return {
    host: REDIS_HOST,
    port: REDIS_PORT,
    ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
    // Pin to `null` so BullMQ's blocking commands keep retrying on
    // transient Redis blips instead of failing the worker.
    maxRetriesPerRequest: null,
  };
}

/**
 * Per-test BullMQ + ioredis bookkeeping. The `beforeEach` /
 * `afterEach` hooks build + tear down these handles in lock-step
 * with the actual suite state so a hung worker from one scenario
 * cannot leak into another.
 *
 * `sharedConnection` is the dedicated ioredis client backing the
 * durable store + pub/sub bus for the test. The Queue / Worker
 * primitives each open their own dedicated blocking connection so
 * the queue's blocking `bzpopmin` does not starve the store or
 * pub/sub clients. A real second pod would have its own Redis
 * client; this in-process test approximates that by giving every
 * primitive a per-instance connection.
 */
interface BullHandle {
  sharedConnection?: Redis;
  queue: Queue<OAuthLoginJobData>;
  workers: Worker<OAuthLoginJobData>[];
  // Dedicated connections opened by Worker instances. The Queue
  // does not need to be tracked here — its connection lifecycle
  // is owned by `Queue.close()`.
  workerConnections: Redis[];
  /**
   * Per-worker `RedisPubSubService` instances. Each worker
   * owns its own bus so the cross-pod subscriber isolation is
   * faithfully simulated (see the `startOAuthLoginWorkerWithBullWorker`
   * jsdoc for the rationale).
   */
  workerPubsubs?: RedisPubSubService[];
  /**
   * Per-worker `OAuthLoginSessionBusService` instances. Each
   * worker gets its own bus wired to its own pubsub service so
   * a publish on the shared channel reaches the new worker's
   * subscriber without re-firing the abandoned first worker's
   * still-registered callback.
   */
  workerBuses?: OAuthLoginSessionBusService[];
  /**
   * Session ids whose durable half the active test wrote to
   * Redis. The `afterEach` hook `DEL`s every key so sibling tests
   * do not inherit stale `oauth:session:*` state. Tests seed
   * their own pending durable record (the worker integration
   * spec drives the WORKER directly, not the producer-side
   * `OAuthLoginService.start`, so the test is responsible for
   * the initial pending record).
   */
  durableSessionIds: Set<string>;
}

describe('OAuthLoginWorker (BullMQ integration)', () => {
  let store: OAuthLoginSessionStore;
  let pubsub: RedisPubSubService;
  let bus: OAuthLoginSessionBusService;
  /**
   * The metrics spy wired through {@link OAuthInstrumentation} for
   * every worker this spec constructs. We never assert on the
   * mutator itself (that's the unit spec's job) — the spy exists
   * so `OAuthLoginWorker`'s constructor type-checks and so the
   * orphan-recovery funnel stays load-bearing without poking the
   * real prom-client registry.
   */
  let noopMetrics: MetricsService;

  /**
   * Bookkeeping for the BullMQ primitives + ioredis connections
   * the active test opened. `afterEach` closes them
   * deterministically; `afterAll` reads `sharedConnection` from a
   * separate field so the `beforeAll` teardown can close it
   * independently of the per-test handles.
   */
  let handle: BullHandle | undefined;
  /**
   * Shared Redis connection separate from the per-test handles —
   * dedicated to the durable store + pub/sub bus so the test can
   * close them in `afterAll` regardless of whether any `it` block
   * ran (the `itIfRedis` gate means a unit-only CI run skips every
   * test, including the bookkeeping in `beforeEach`).
   */
  let suiteRedis: Redis | undefined;

  beforeAll(async () => {
    if (!REDIS_HOST) {
      return;
    }
    suiteRedis = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 5_000,
      retryStrategy: (times: number) => {
        if (times > 1) return null;
        return 500;
      },
    });
    suiteRedis.on('error', () => undefined);
    await suiteRedis.ping();

    store = new OAuthLoginSessionStore(suiteRedis);
    pubsub = new RedisPubSubService(suiteRedis);
    bus = new OAuthLoginSessionBusService(pubsub);

    noopMetrics = {
      recordOAuthLoginOrphaned: vi.fn(),
    } as unknown as MetricsService;
  });

  afterAll(async () => {
    if (!REDIS_HOST) {
      return;
    }
    if (pubsub) {
      try {
        pubsub.onModuleDestroy();
      } catch {
        // best effort — process is about to exit.
      }
    }
    if (suiteRedis) {
      try {
        await suiteRedis.quit();
      } catch {
        suiteRedis.disconnect();
      }
    }
  });

  beforeEach(async () => {
    if (!REDIS_HOST) {
      return;
    }
    handle = {
      queue: new Queue<OAuthLoginJobData>(OAUTH_LOGIN_SESSION_JOB_QUEUE, {
        connection: makeBullConnection(),
        defaultJobOptions: defaultJobOptions(),
      }),
      workers: [],
      workerConnections: [],
      durableSessionIds: new Set<string>(),
    };
    // Clean any leftover jobs in the shared `oauth-login` queue
    // from prior runs. The suite shares the queue name with
    // production (`OAUTH_LOGIN_SESSION_JOB_QUEUE`), and a previous
    // test run's jobs — particularly `failed` jobs, which the
    // production producer's `removeOnFail: false` retains — would
    // be picked up by the freshly-spawned worker first, polluting
    // the new test's journal/progress assertions.
    //
    // `obliterate({ force: true })` is the most thorough cleanup:
    // it removes jobs in every state (waiting / active / failed /
    // completed / delayed) and the queue-level metadata. The
    // `force: true` flag skips the safety check that prevents
    // obliterating an active queue (without it, calling obliterate
    // while another worker is listening would throw).
    try {
      await handle.queue.obliterate({ force: true });
    } catch {
      // best effort — the obliterate is a test-cleanliness nicety,
      // not a correctness requirement. If the queue's underlying
      // connection has been torn down by a previous failure
      // path, swallow the error so the next test still runs.
    }
  });

  afterEach(async () => {
    if (!REDIS_HOST) {
      return;
    }
    if (!handle) {
      return;
    }
    // Force-close every worker. The SDK's `provider.login` may
    // still be hanging on `onManualCodeInput()` (the cross-pod
    // scenario's "user has not yet pasted a code" shape), so a
    // graceful `close()` would block on
    // `whenCurrentJobsFinished`. `close(true)` aborts the
    // in-flight job's lock immediately.
    for (const workerHandle of handle.workers) {
      try {
        await workerHandle.close(true);
      } catch {
        // best effort.
      }
    }
    // Close the queue (best effort — a `force` argument is not
    // exposed on `Queue.close`, and the queue's internal Redis
    // connection is QUIT'd via the queue's own teardown path).
    try {
      await handle.queue.close();
    } catch {
      // best effort.
    }
    for (const connection of handle.workerConnections) {
      try {
        await connection.quit();
      } catch {
        connection.disconnect();
      }
    }
    // Best-effort cleanup of any durable session keys the test
    // may have written, so a Redis DB shared across runs does
    // not accumulate `oauth:session:*` records.
    if (handle?.durableSessionIds) {
      for (const sessionId of handle.durableSessionIds) {
        try {
          await suiteRedis?.del(`oauth:session:${sessionId}`);
        } catch {
          // ignore — best effort.
        }
      }
    }
    handle = undefined;
  });

  /**
   * Build a fully-wired `OAuthLoginWorker` instance plus the
   * matching BullMQ `Worker` that delegates the framework's
   * `process(job)` invocation to the real worker. Pinning both
   * in one helper keeps the per-test setup identical across
   * scenarios so a regression in either the worker or the
   * BullMQ wiring surfaces inside the caller.
   *
   * Each worker opens its own dedicated ioredis connection so
   * the BullMQ blocking `bzpopmin` cannot starve sibling
   * primitives. The connection lifetime is owned by the
   * `handle.workerConnections` array so `afterEach` closes it.
   *
   * Each worker ALSO gets its own dedicated `RedisPubSubService`
   * + `OAuthLoginSessionBusService` pair so the cross-pod
   * subscriber isolation is faithfully simulated: in production,
   * every pod owns its own Redis subscriber client, so when
   * pod #1 dies its subscriber-side fan-out goes with it and
   * the next publish only reaches pod #2's subscriber. Sharing
   * the suite-level `bus` across both workers would leak
   * pod #1's still-alive subscriber callback into the
   * post-close publish window, which in turn would re-resolve
   * worker #1's abandoned `provider.login` Promise and trigger
   * a `markTerminalFailure('Connection is closed')` race. The
   * per-worker bus keeps that race out of the test scope (it
   * exists in production code paths but only via the
   * `OAuthLoginWorker.onModuleDestroy` hook, which the
   * `bullWorker.close(true)` here does NOT invoke on the
   * underlying `OAuthLoginWorker` instance — the abandoned
   * processFn chain is intentionally orphaned in tests).
   */
  function startOAuthLoginWorkerWithBullWorker(
    provider: OAuthProviderInterface,
  ): {
    oauthWorker: OAuthLoginWorker;
    bullWorker: Worker<OAuthLoginJobData>;
    resolver: OAuthProviderResolver;
    workerBus: OAuthLoginSessionBusService;
    workerPubsub: RedisPubSubService;
  } {
    if (!handle) {
      throw new Error(
        'startOAuthLoginWorkerWithBullWorker requires handle — caller must guard with itIfRedis',
      );
    }
    const resolver = makeResolver(provider);
    const instrumentation = new OAuthInstrumentation(noopMetrics);
    // Per-worker bus + pubsub on a dedicated Redis connection.
    // `duplicate()` creates a fresh subscriber client so the
    // BullMQ blocking connection and the pub/sub subscriber are
    // isolated from each other — the same shape
    // `RedisPubSubService` uses in production.
    const workerPubsubConnection = new Redis(makeBullConnection());
    handle.workerConnections.push(workerPubsubConnection);
    const workerPubsub = new RedisPubSubService(workerPubsubConnection);
    handle.workerPubsubs = handle.workerPubsubs ?? [];
    handle.workerPubsubs.push(workerPubsub);
    const workerBus = new OAuthLoginSessionBusService(workerPubsub);
    handle.workerBuses = handle.workerBuses ?? [];
    handle.workerBuses.push(workerBus);
    const oauthWorker = new OAuthLoginWorker(
      store,
      workerBus,
      resolver,
      instrumentation,
    );
    const bullWorkerConnection = new Redis(makeBullConnection());
    handle.workerConnections.push(bullWorkerConnection);
    const bullWorker = new Worker<OAuthLoginJobData>(
      OAUTH_LOGIN_SESSION_JOB_QUEUE,
      async (job) => oauthWorker.process(job),
      {
        connection: makeBullConnection(),
        // Pin lock/stall cadence to a test-friendly 1 s so the
        // close+restart cycle settles inside a 2 s sleep below.
        lockDuration: 1_000,
        lockRenewTime: 500,
        stalledInterval: 1_000,
        maxStalledCount: 5,
        concurrency: 1,
        // BullMQ's `Worker` constructor sets `autorun: true` by
        // default — the worker starts polling the queue the
        // moment its constructor returns. Disable `autorun` so
        // the test owns the start lifecycle explicitly via
        // `void bullWorker.run()` + a 100 ms startup sleep.
        autorun: false,
      },
    );
    handle.workers.push(bullWorker);
    return { oauthWorker, bullWorker, resolver, workerBus, workerPubsub };
  }

  /**
   * Scenario A — journal/replay path (rehydrate-and-resume):
   *
   *   1. Build a fresh `OAuthLoginWorker` + matching BullMQ `Worker`
   *      against the dedicated Redis store + bus.
   *   2. Enqueue a session via the real BullMQ `Queue`. The
   *      `jobId` matches the `sessionId` so a close+restart cycle
   *      reuses the SAME BullMQ job record (matches the producer's
   *      `jobId`-from-`sessionId` convention in
   *      `OAuthLoginService.start`).
   *   3. Wait briefly for the worker to pick the job up; verify it
   *      journals `auth_initiated` via the production
   *      `Job.updateProgress` round-trip (read back via
   *      `queue.getJob(sessionId).progress`).
   *   4. Force-close the BullMQ Worker to simulate pod death. The
   *      active job is hanging on `onManualCodeInput` so a graceful
   *      `close()` would block on `whenCurrentJobsFinished`.
   *   5. Spin up a SECOND `Worker` on the same queue + a dedicated
   *      ioredis connection, using a FRESH `OAuthLoginWorker`
   *      instance with its OWN per-pod transient map. The
   *      stalled-job recovery moves the SAME BullMQ job back to
   *      the wait queue; worker #2 picks it up and reads the
   *      journal.
   *   6. Verify the new worker reads the journal and does NOT
   *      re-call `provider.login` (assert via the mock provider's
   *      call count: 1, not 2). This is the load-bearing
   *      WR-2 contract any future regression that re-invokes the
   *      SDK on stalled recovery would double.
   *   7. Deliver the code via `sessionBus.publishCode(sessionId, code)`
   *      so the publish-before-subscribe round-trip is exercised
   *      end-to-end. The rehydration branch intentionally does NOT
   *      drive the SDK on the new pod (per WR-2), so the code is
   *      recorded in the subscriber-side deferred but never
   *      reaches the credentials minting path.
   *   8. Assert the durable Redis record preserves the
   *      `auth_initiated`-driven `modality: 'authcode'` +
   *      `authorizeUrl` from worker #1's `onAuth`.
   *
   * Why directly read the durable half instead of `service.getStatus`:
   * `getStatus` runs the orphan-detection branch when no live BullMQ
   * job is queued. After worker #2's `process()` resolves (with no
   * terminal journal), the job is "completed" and `getStatus` would
   * re-transition the session to `failed`. The rehydration path
   * itself preserves the pending state (it doesn't mint credentials
   * on the new pod), so reading the durable key directly is the
   * only way to assert the journal/replay invariants without
   * orphan-detection contaminating the assertion.
   */
  itIfRedis(
    'reads the journal on a fresh worker without re-invoking provider.login (journal/replay path)',
    async () => {
      if (!handle) {
        throw new Error('handle is undefined — beforeEach did not initialize');
      }

      // The mock provider: SDK calls `onAuth`, then awaits the
      // manual-code Promise. This mirrors the "in-flight login
      // where the user has not yet pasted a code" state a real
      // session sits in between `start()` and `submitCode()`. The
      // rehydration branch intentionally does NOT drive the SDK on
      // the new pod (per WR-2), so the credentials minting path
      // is never reached on the rehydrated worker. Keeping the
      // provider hanging on a never-resolving Promise is the
      // correct shape: it lets the test pin the SDK's in-flight
      // state on worker #1 while worker #2 rehydrates without
      // re-entering the SDK.
      const provider = makeFactoryProvider();

      const first = startOAuthLoginWorkerWithBullWorker(provider);
      const { bullWorker } = first;
      // Start the worker in the BACKGROUND — `run()` is an async
      // function whose returned Promise resolves only when the
      // worker closes (its body awaits `mainLoopRunning`).
      // Awaiting it inline would hang the test until the worker
      // closes. The `startOAuthLoginWorkerWithBullWorker` helper
      // builds the Worker with `autorun: false` so the test owns
      // the start lifecycle explicitly. The 100 ms sleep gives
      // the worker a moment to register the bzpopmin blocking
      // connection before the producer enqueues the job.
      void bullWorker.run();
      await sleep(100);

      // Enqueue a session via the real BullMQ Queue. The jobId
      // matches the sessionId so a close+restart cycle reuses the
      // SAME BullMQ job record (matches the producer's
      // jobId-from-sessionId convention).
      const sessionId = randomUUID();
      handle?.durableSessionIds.add(sessionId);

      // Seed the initial pending durable record before enqueueing
      // the job. The worker's `transitionDurable(...)` helper
      // silently returns when the durable key is missing
      // (production `OAuthLoginService.start` writes the initial
      // record; this spec exercises the worker in isolation so the
      // test must seed the durable half itself). Without this
      // seed, the worker's `onAuth`-driven transitions would not
      // persist and the durable-state assertions below would see
      // a null record.
      await store.put(sessionId, {
        id: sessionId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });

      const payload: OAuthLoginJobPayload & { journal: { events: never[] } } = {
        sessionId,
        piProviderId: provider.id,
        journal: { events: [] },
      };
      await handle.queue.add(OAUTH_LOGIN_RUN_JOB, payload, {
        jobId: sessionId,
      });

      // Wait for the first worker to begin processing + journal
      // `auth_initiated`. The journal `updateProgress` is a real
      // Redis round-trip, so 1 s is generous for CI.
      await sleep(1_000);

      // Sanity: `provider.login` was called exactly once by the
      // first worker. Pinning the call count before the close
      // makes the rehydration assertion below unambiguous.
      expect(provider.login).toHaveBeenCalledTimes(1);

      // Read the journal state directly off the BullMQ job's
      // `progress` so the journal write is observable through the
      // production storage path (the same read path a fresh pod
      // would use after a stalled-job recovery). The journal must
      // record the `auth_initiated` event the first worker
      // checkpointed via `job.updateProgress`.
      const firstReadJob = await handle.queue.getJob(sessionId);
      expect(firstReadJob).not.toBeNull();
      const firstReadJournal = firstReadJob?.progress as
        | { events: Array<{ type: string }> }
        | undefined;
      const firstReadEventTypes = (firstReadJournal?.events ?? []).map(
        (event) => event.type,
      );
      expect(firstReadEventTypes).toContain('auth_initiated');

      // Simulate pod death: force-close the first worker AND
      // tear down its dedicated `RedisPubSubService` subscriber
      // client so a subsequent `publishCode` lands ONLY on
      // pod #2's subscriber. Without the explicit teardown
      // below, the SHARED Redis server still routes the
      // publish to pod #1's (live!) subscriber connection,
      // which re-resolves the abandoned `provider.login` Promise
      // on worker #1's side and triggers a
      // `markTerminalFailure('Connection is closed')` race when
      // worker #1's `handleFreshStart` catch tries to
      // `job.updateProgress` through the closed BullMQ job
      // client. Disconnecting pod #1's pubsub subscriber is the
      // closest in-process analogue to a real pod kill (in
      // production, pod #1's subscriber connection dies with
      // the process).
      await bullWorker.close(true);
      try {
        first.workerPubsub.onModuleDestroy();
      } catch {
        // best effort — the pubsub may already be torn down
        // if BullMQ's close path traced back into it.
      }

      // Build a SECOND worker on the same queue + a dedicated
      // ioredis connection. Using a separate `OAuthLoginWorker`
      // instance simulates a brand-new pod with its OWN per-pod
      // `transient` map — if the test reused the first worker,
      // the rehydration contract would be silently bypassed via
      // the original pod's own in-memory state.
      const second = startOAuthLoginWorkerWithBullWorker(provider);
      // See the firstWorker note above re: `void run()` — the
      // freshly-spawned worker follows the same start pattern.
      void second.bullWorker.run();
      await sleep(100);

      // Wait for stalled-job recovery + worker #2 to begin
      // rehydrating. The recovery cycle is bounded by
      // `stalledInterval: 1_000` so 2 s is the realistic worst
      // case (one tick for the stalled-checker + one bzpopmin
      // round).
      await sleep(2_000);

      // Read the journal AFTER the second worker has had a
      // chance to process the stalled job. The journal must still
      // record `auth_initiated` (the first worker's checkpoint is
      // durable across worker restarts) and MUST NOT record
      // `connected` or a new `code_delivered` (the rehydration
      // branch never drives the SDK and the in-flight
      // `provider.login` Promise is abandoned on `close(true)`).
      const secondReadJob = await handle.queue.getJob(sessionId);
      expect(secondReadJob).not.toBeNull();
      const secondReadJournal = secondReadJob?.progress as
        | { events: Array<{ type: string }> }
        | undefined;
      const secondReadEventTypes = (secondReadJournal?.events ?? []).map(
        (event) => event.type,
      );
      expect(secondReadEventTypes).toContain('auth_initiated');
      expect(secondReadEventTypes).not.toContain('connected');

      // WR-2 contract: `provider.login` was NOT re-invoked by the
      // fresh worker. The call count stays at 1 across both
      // workers — the journal read was the only cross-pod state
      // the new worker relied on. This is the load-bearing
      // rehydration guarantee: any future regression that
      // accidentally re-runs `provider.login` on stalled recovery
      // doubles the call count and surfaces here.
      expect(provider.login).toHaveBeenCalledTimes(1);

      // Deliver the code via the SECOND worker's bus (not the
      // suite-level shared bus). Each worker owns its own pubsub
      // service so the cross-pod subscriber isolation is
      // faithful — in production, pod #1's subscriber client
      // dies with the pod, so the post-close publish ONLY
      // reaches pod #2's subscriber. Publishing through the
      // suite-level shared bus would also re-fire pod #1's
      // abandoned subscribe callback and trigger a
      // `markTerminalFailure('Connection is closed')` race
      // (because pod #1's processFn is still active in the JS
      // event loop even after `close(true)`). Routing the
      // publish through the second worker's bus keeps that
      // race out of the test scope. The rehydration branch
      // subscribes to the session's code channel BEFORE
      // settling on the timeout, so the second worker's
      // subscriber receives the publish.
      await second.workerBus.publishCode(sessionId, 'worker-int-paste');

      // Allow the publish + subscriber fan-out to settle. We do
      // NOT call `service.getStatus` here because the
      // orphan-detection branch would re-transition the durable
      // half to `failed` once the second worker's `process()`
      // resolves with no terminal journal — a side effect
      // unrelated to the journal/replay contract under test.
      await sleep(1_000);

      // Direct read of the durable half (avoids the
      // orphan-detection branch above): the rehydration path
      // preserves worker #1's `onAuth`-driven transition to
      // `modality: 'authcode'` + `authorizeUrl` from worker #1's
      // `onAuth`. If worker #2 had silently re-invoked
      // `provider.login`, the durable half would be in an
      // unexpected state; the read here confirms worker #2 took
      // the rehydration branch (no further transitions happened).
      const durable = await store.get(sessionId);
      expect(durable).not.toBeNull();
      expect(durable?.status).toBe('pending');
      expect(durable?.modality).toBe('authcode');
      expect(durable?.authorizeUrl).toMatch(
        /^https:\/\/authorize-worker-int\?code=true/,
      );

      // Cleanup of the second worker is handled by the
      // `afterEach` hook's force-close loop; calling it
      // explicitly here too keeps the worker connection count
      // out of the "process.exit called before async operations
      // completed" Vitest warning if the hook timeout is short.
      try {
        await second.bullWorker.close(true);
      } catch {
        // best effort — the afterEach hook closes it again.
      }
    },
  );
});
