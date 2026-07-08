/**
 * Unit tests for the BullMQ {@link OAuthLoginWorker} processor.
 *
 * Work item: `d8744e56-292b-45bf-9217-42418427891a` (M5).
 *
 * Scope:
 *   The worker is a thin, dispatch-by-journal coordinator around the
 *   four end-states a `provider.login` Promise can settle to:
 *
 *     1. Fresh-start (no journal events yet) → call `provider.login`,
 *        journal `auth_initiated`, wait for manual code via the bus,
 *        journal `code_delivered`, transition to `connected`.
 *     2. Rehydration (journal records an `auth_initiated` /
 *        `device_initiated` event without a terminal) → do NOT
 *        re-invoke `provider.login`, re-subscribe to the code
 *        channel, race the timeout against any further delivery,
 *        and let the timeout settle the durable half to `failed`.
 *     3. Prior abort (`abort_issued` in journal) → do NOT invoke
 *        `provider.login`; acknowledge the abort by transitioning
 *        the durable half to `failed` with the abort message.
 *     4. Code-delivered in journal (`auth_initiated` +
 *        `code_delivered` with no terminal) → resolve the
 *        manual-code deferred immediately so the wait is bounded
 *        by the timeout alone; do NOT invoke `provider.login`.
 *     5. Terminal failure (SDK throws) → `markTerminalFailure`
 *        journals `failed`, transitions the durable half, and
 *        the `failed` event surfaces on a subsequent
 *        `getStatus` poll.
 *
 * The processor only reads `job.name`, `job.data`,
 * `job.progress`, and calls `job.updateProgress` — a partial Job
 * cast is sufficient. Constructing the worker with
 * `new OAuthLoginWorker(...)` and typed-mock dependencies
 * (no `Test.createTestingModule`) exercises the same code path
 * BullMQ would invoke without booting a Nest module.
 *
 * Why not `Test.createTestingModule`:
 *   The processor's only collaborators are the session store, the
 *   session bus, the provider resolver, and the
 *   `OAuthInstrumentation` helper. Constructing the worker
 *   directly with typed mocks is the same pattern used by
 *   `apps/api/src/memory/memory-decay.processor.spec.ts` —
 *   minimal wiring, no Redis / BullMQ connection, no leaked
 *   timers (every spec uses `vi.useFakeTimers()` for the
 *   20-second initiation timeout so the worker settles inside
 *   the microtask budget).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type {
  OAuthCredentials,
  OAuthLoginCallbacks,
  OAuthProviderInterface,
} from '@earendil-works/pi-ai/oauth';
import { OAUTH_LOGIN_RUN_JOB } from '@nexus/core/schemas/oauth';
import { OAuthLoginWorker } from './oauth-login.worker';
import { createAnthropicOAuthProvider } from './anthropic-oauth.provider';
import type {
  OAuthLoginJobData,
  OAuthLoginJobJournal,
  OAuthLoginJobPayload,
} from './oauth-login.worker.types';
import type {
  OAuthLoginSessionBus,
  OAuthProviderResolver,
} from './oauth-login.types';
import type { OAuthLoginSessionStore } from './oauth-login-session.store';
import type { OAuthInstrumentation } from './oauth-instrumentation';
import type { OAuthSessionState } from '@nexus/core/schemas/oauth';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const CREDS: OAuthCredentials = {
  access: 'access-token',
  refresh: 'refresh-token',
  expires: 1_000,
};

interface MockSessionStore {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

function createMockSessionStore(
  overrides: Partial<MockSessionStore> = {},
): MockSessionStore {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

interface MockSessionBus {
  subscribeToCode: ReturnType<typeof vi.fn>;
  publishCode: ReturnType<typeof vi.fn>;
}

function createMockSessionBus(
  overrides: Partial<MockSessionBus> = {},
): MockSessionBus {
  return {
    subscribeToCode: vi.fn(),
    publishCode: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

interface MockProviderResolver {
  resolve: ReturnType<typeof vi.fn>;
}

function createMockResolver(
  provider: OAuthProviderInterface,
): MockProviderResolver {
  return {
    resolve: vi.fn(async (id: string) =>
      id === provider.id ? provider : undefined,
    ),
  };
}

interface MockOAuthInstrumentation {
  recordOAuthLoginOrphaned: ReturnType<typeof vi.fn>;
}

function createMockInstrumentation(
  overrides: Partial<MockOAuthInstrumentation> = {},
): MockOAuthInstrumentation {
  return {
    recordOAuthLoginOrphaned: vi.fn(),
    ...overrides,
  };
}

/**
 * Fixture Anthropic OAuth config. Mirrors the shape the production
 * {@link PiAiOAuthProviderResolver} reads from the `llm_providers` DB row
 * so the worker specs exercise the factory-built provider rather than a
 * hand-crafted mock.
 */
const ANTHROPIC_OAUTH_FIXTURE = {
  clientId: 'test-client-id',
  authorizeUrl: 'https://authorize',
  tokenUrl: 'https://token.example',
  redirectUri: 'https://redirect.example',
  scopes: 'scope:one scope:two',
};

interface MockProvider {
  id: string;
  name: string;
  login: ReturnType<typeof vi.fn>;
  refreshToken: ReturnType<typeof vi.fn>;
  getApiKey: ReturnType<typeof vi.fn>;
}

function makeProviderMock(
  loginImpl?: (cb: OAuthLoginCallbacks) => Promise<OAuthCredentials>,
): MockProvider {
  const base = createAnthropicOAuthProvider(ANTHROPIC_OAUTH_FIXTURE);
  return {
    id: base.id,
    name: base.name,
    login: vi.fn(loginImpl ?? base.login),
    refreshToken: vi.fn(base.refreshToken),
    getApiKey: vi.fn(base.getApiKey),
  };
}

/**
 * Factory-built provider whose `login` always rejects. Used by the
 * terminal-failure scenario to keep the provider identity realistic
 * while forcing the SDK-throw branch.
 */
function makeThrowingProvider(error: Error): MockProvider {
  const base = createAnthropicOAuthProvider(ANTHROPIC_OAUTH_FIXTURE);
  return {
    id: base.id,
    name: base.name,
    login: vi.fn(async () => {
      throw error;
    }),
    refreshToken: vi.fn(base.refreshToken),
    getApiKey: vi.fn(base.getApiKey),
  };
}

/**
 * Build a `Job`-like object literal.
 *
 * The processor only reads `job.name`, `job.data`, `job.progress`,
 * and calls `job.updateProgress`. `id`, `attemptsMade`, and the
 * other BullMQ-internal fields are unused by the worker's
 * dispatch shim — so a partial cast through unknown is sufficient.
 *
 * The `progress` field is mutable so the worker's journal writes
 * are observable after `process()` resolves. `updateProgress` is a
 * stub that mirrors the latest journal so the spec can assert on
 * the final state.
 */
function makeJob(
  payload: OAuthLoginJobPayload,
  progress: OAuthLoginJobJournal = { events: [] },
  name: string = OAUTH_LOGIN_RUN_JOB,
): {
  job: Job<OAuthLoginJobData>;
  updateProgressSpy: ReturnType<typeof vi.fn>;
} {
  const updateProgressSpy = vi.fn(async (next: OAuthLoginJobJournal) => {
    progress = next;
  });
  const job = {
    name,
    data: { ...payload, journal: progress },
    progress,
    updateProgress: updateProgressSpy,
  } as unknown as Job<OAuthLoginJobData>;
  return { job, updateProgressSpy };
}

/**
 * Wire a fresh worker against the supplied mocks. Mirrors the
 * `createMockReaper()` + `new MemoryDecayProcessor(...)` shape
 * used in `memory-decay.processor.spec.ts`.
 */
function createWorker(options: {
  store: MockSessionStore;
  bus: MockSessionBus;
  resolver: MockProviderResolver;
  instrumentation?: MockOAuthInstrumentation;
}): OAuthLoginWorker {
  const instrumentation =
    options.instrumentation ?? createMockInstrumentation();
  return new OAuthLoginWorker(
    options.store as unknown as OAuthLoginSessionStore,
    options.bus as unknown as OAuthLoginSessionBus,
    options.resolver as unknown as OAuthProviderResolver,
    instrumentation as unknown as OAuthInstrumentation,
  );
}

/**
 * Seed the session store with a pending durable record so the
 * worker's `transitionDurable(...)` calls have a current record
 * to read. Without this seeding step, `transitionDurable` exits
 * early on the `current === null` guard and the assertions on
 * durable state would pass trivially.
 */
async function seedPendingDurable(
  store: MockSessionStore,
  sessionId: string,
  extras: Partial<OAuthSessionState> = {},
): Promise<OAuthSessionState> {
  const record: OAuthSessionState = {
    id: sessionId,
    status: 'pending',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    ...extras,
  };
  // Seed `get` to return the durable record. The worker's
  // `transitionDurable` reads through `get` and only writes
  // through `put` if `get` returned a non-null record — so this
  // is the single hook a unit test needs to exercise the worker's
  // `transitionDurable` write path.
  store.get.mockResolvedValue(record);
  // `put` is the production `SET ... EX 900` analogue. The
  // default `createMockSessionStore` already provides a
  // `vi.fn().mockResolvedValue(undefined)` no-op; we leave it
  // alone so the worker call sites land on the spy untouched.
  return record;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuthLoginWorker', () => {
  let store: MockSessionStore;
  let bus: MockSessionBus;
  let instrumentation: MockOAuthInstrumentation;
  let worker: OAuthLoginWorker;

  beforeEach(() => {
    // Each test builds a fresh worker against fresh mocks via the
    // `createWorker(...)` helper above. The module-level
    // `beforeEach` only allocates the shared mocks and a fresh
    // worker stub so every test can decide whether to keep the
    // stub or wire its own resolver.
    store = createMockSessionStore();
    bus = createMockSessionBus();
    instrumentation = createMockInstrumentation();
    worker = {} as OAuthLoginWorker;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('process', () => {
    it('fresh-start path: journals auth_initiated and calls provider.login exactly once', async () => {
      // The fresh-start branch subscribes BEFORE invoking provider.login
      // (publish-before-subscribe race guard), invokes the SDK
      // callbacks which fire `onAuth` synchronously, then drives the
      // login to a terminal `connected` outcome. The provider is now
      // factory-built from fixture values, so `global.fetch` is
      // stubbed to return the token exchange response.
      const sessionId = 'fresh-start-session';
      const provider = makeProviderMock();
      const resolverMock = createMockResolver(
        provider as unknown as OAuthProviderInterface,
      );
      worker = createWorker({
        store,
        bus,
        resolver: resolverMock,
        instrumentation,
      });
      await seedPendingDurable(store, sessionId);

      const fetchResponse = {
        ok: true,
        text: async () =>
          JSON.stringify({
            access_token: CREDS.access,
            refresh_token: CREDS.refresh,
            expires_in: 1,
          }),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchResponse));

      let updateProgressSpy: ReturnType<typeof vi.fn> | undefined;
      try {
        const { job, updateProgressSpy: spy } = makeJob({
          sessionId,
          piProviderId: 'anthropic',
        });
        updateProgressSpy = spy;

        // Kick off `process()` without awaiting yet so we can publish
        // the manual code AFTER the bus subscription is wired (publish-
        // before-subscribe race guard contract).
        const processPromise = worker.process(job);

        // Give the worker one microtask tick to settle the bus
        // subscribe side effect.
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Publish the code on the bus for the in-flight worker.
        const subscribeCall = bus.subscribeToCode.mock.calls[0];
        expect(subscribeCall?.[0]).toBe(sessionId);
        const subscriber = subscribeCall?.[1] as (code: string) => void;
        expect(typeof subscriber).toBe('function');
        subscriber('paste-1');

        await processPromise;
      } finally {
        vi.unstubAllGlobals();
      }

      // `provider.login` was called exactly once with the full
      // callbacks object — the callbacks object is observable
      // through the `login.mock.calls[0][0]` capture.
      expect(provider.login).toHaveBeenCalledTimes(1);
      const callbacksArg = provider.login.mock
        .calls[0]?.[0] as OAuthLoginCallbacks;
      expect(callbacksArg).toBeDefined();
      expect(typeof callbacksArg.onAuth).toBe('function');
      expect(typeof callbacksArg.onDeviceCode).toBe('function');
      expect(typeof callbacksArg.onManualCodeInput).toBe('function');
      expect(typeof callbacksArg.onPrompt).toBe('function');
      expect(typeof callbacksArg.onSelect).toBe('function');

      // The journal captured `auth_initiated` first, then
      // `code_delivered`, then `connected`. Each transition was
      // checkpointed through `job.updateProgress`.
      expect(updateProgressSpy).toBeDefined();
      expect(updateProgressSpy).toHaveBeenCalled();
      const lastJournal = updateProgressSpy.mock.calls.at(
        -1,
      )?.[0] as OAuthLoginJobJournal;
      expect(lastJournal).toBeDefined();
      const eventTypes = lastJournal.events.map((event) => event.type);
      expect(eventTypes).toContain('auth_initiated');
      expect(eventTypes).toContain('code_delivered');
      expect(eventTypes).toContain('connected');

      // The durable half transitioned to `connected`.
      const putCalls = store.put.mock.calls;
      expect(
        putCalls.some(
          ([, state]) => (state as OAuthSessionState).status === 'connected',
        ),
      ).toBe(true);
    });

    it('rehydration path: does NOT invoke provider.login and re-subscribes to the code channel', async () => {
      // Rehydration (WR-2): the journal records an `auth_initiated`
      // event but no terminal. The worker does NOT re-invoke
      // provider.login — per WR-2 the SDK callback chain may have
      // already produced one call on the original owning pod.
      // Instead, it re-subscribes to the code channel so any
      // further publish lands on the freshly-spawned worker.
      const sessionId = 'rehydration-session';
      const provider = makeProviderMock();
      const resolverMock = createMockResolver(
        provider as unknown as OAuthProviderInterface,
      );
      worker = createWorker({
        store,
        bus,
        resolver: resolverMock,
        instrumentation,
      });
      await seedPendingDurable(store, sessionId);

      const { job, updateProgressSpy } = makeJob(
        { sessionId, piProviderId: 'anthropic' },
        {
          events: [
            {
              type: 'auth_initiated',
              authorizeUrl: 'https://authorize',
            },
          ],
        },
      );

      vi.useFakeTimers();
      try {
        // The worker's handleRehydration races the manual-code
        // deferred against the 20-second initiation timeout. Use
        // fake timers so we can advance past the timeout without
        // blocking the test.
        const processPromise = worker.process(job);

        // Give the subscribe side effect one tick to land on the
        // mock bus before any further assertions.
        await vi.advanceTimersByTimeAsync(0);

        // `sessionBus.subscribeToCode` was called for the session id —
        // the worker re-attached to the channel.
        expect(bus.subscribeToCode).toHaveBeenCalledTimes(1);
        expect(bus.subscribeToCode.mock.calls[0]?.[0]).toBe(sessionId);

        // `provider.login` was NOT called — the rehydration branch
        // never invokes the SDK a second time.
        expect(provider.login).not.toHaveBeenCalled();

        // Advance past the 20-second initiation timeout. The
        // race settles via the timeout promise (rejecting), the
        // worker's `Promise.race([..., timeout]).catch(...)` swallows
        // the rejection, and `process()` returns.
        await vi.advanceTimersByTimeAsync(20_000);
        await processPromise;

        // The initiation-timeout handler journals `failed` with
        // the timeout error and transitions the durable half to
        // `failed`. `updateProgress` is called with the final
        // journal containing both `auth_initiated` and `failed`.
        const lastJournal = updateProgressSpy.mock.calls.at(
          -1,
        )?.[0] as OAuthLoginJobJournal;
        const eventTypes = lastJournal.events.map((event) => event.type);
        expect(eventTypes).toContain('auth_initiated');
        expect(eventTypes).toContain('failed');

        const putCalls = store.put.mock.calls;
        expect(
          putCalls.some(
            ([, state]) => (state as OAuthSessionState).status === 'failed',
          ),
        ).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('abort-issued path: does NOT invoke provider.login and transitions the durable half to failed with the abort message', async () => {
      // The prior-abort branch: journal records `abort_issued` so
      // the worker MUST acknowledge it by transitioning the durable
      // half to `failed` with the canonical abort message. It MUST
      // NOT re-invoke `provider.login` because the original owning
      // pod already aborted the SDK.
      const sessionId = 'abort-session';
      const provider = makeProviderMock();
      const resolverMock = createMockResolver(
        provider as unknown as OAuthProviderInterface,
      );
      worker = createWorker({
        store,
        bus,
        resolver: resolverMock,
        instrumentation,
      });
      await seedPendingDurable(store, sessionId);

      const { job, updateProgressSpy } = makeJob(
        { sessionId, piProviderId: 'anthropic' },
        {
          events: [{ type: 'abort_issued' }],
        },
      );

      await worker.process(job);

      // `provider.login` was NOT called.
      expect(provider.login).not.toHaveBeenCalled();

      // The durable half transitioned to `failed` with the abort
      // error message — observable through the `put` call args.
      const putCalls = store.put.mock.calls;
      const failedWrite = putCalls.find(
        ([, state]) => (state as OAuthSessionState).status === 'failed',
      );
      expect(failedWrite).toBeDefined();
      expect((failedWrite?.[1] as OAuthSessionState).error).toBe(
        'OAuth login aborted',
      );

      // The journal captured the `failed` event via
      // `job.updateProgress`.
      const lastJournal = updateProgressSpy.mock.calls.at(
        -1,
      )?.[0] as OAuthLoginJobJournal;
      expect(lastJournal.events.at(-1)?.type).toBe('failed');
    });

    it('code-delivered-in-journal path: does NOT invoke provider.login, subscribes to the code channel, and resolves without re-running the SDK', async () => {
      // A journal with `auth_initiated` + `code_delivered` but no
      // terminal outcome. The rehydration branch resolves the
      // manual-code deferred immediately (the code is already in
      // the journal) so the worker's Promise.race settles on the
      // first microtask — observable as:
      //   * `provider.login` NOT called (the rehydration branch
      //     never re-invokes the SDK; this is the WR-2 contract);
      //   * `sessionBus.subscribeToCode` IS called (the worker
      //     re-attached to the code channel so any further
      //     publish lands here rather than on a stale owning
      //     pod);
      //   * the durable half is preserved (NOT transitioned to
      //     `connected` — `handleRehydration` deliberately does
      //     not re-invoke the SDK and therefore cannot produce
      //     new credentials; the journal rehydrates from the
      //     existing record).
      const sessionId = 'code-delivered-session';
      const provider = makeProviderMock();
      const resolverMock = createMockResolver(
        provider as unknown as OAuthProviderInterface,
      );
      worker = createWorker({
        store,
        bus,
        resolver: resolverMock,
        instrumentation,
      });
      await seedPendingDurable(store, sessionId);

      const { job, updateProgressSpy } = makeJob(
        { sessionId, piProviderId: 'anthropic' },
        {
          events: [
            {
              type: 'auth_initiated',
              authorizeUrl: 'https://authorize',
            },
            { type: 'code_delivered', code: 'paste-1' },
          ],
        },
      );

      // The rehydration branch resolves the manual-code deferred
      // synchronously on this path, so the worker returns inside
      // one microtask — no fake timers needed for this test.
      await worker.process(job);

      // `provider.login` was NOT called — the rehydration branch
      // never invokes the SDK.
      expect(provider.login).not.toHaveBeenCalled();

      // `sessionBus.subscribeToCode` was called for the session
      // id (the worker re-attached to the channel so a
      // subsequent publish lands here).
      expect(bus.subscribeToCode).toHaveBeenCalledTimes(1);
      expect(bus.subscribeToCode.mock.calls[0]?.[0]).toBe(sessionId);

      // The worker's journal was NOT checkpointed from inside
      // `handleRehydration` — neither `markTerminalFailure` nor
      // `markConnected` runs on the rehydration path. (The
      // timer-firing assertion that follows is what would
      // append a `failed` event later, but in this test the
      // timer is never advanced past 20 seconds so the worker's
      // own write does not happen.)
      expect(updateProgressSpy).not.toHaveBeenCalled();

      // No durable write happened — the rehydration path
      // preserves the existing `pending` state rather than
      // churning it. (The `get` was NOT re-invoked either;
      // the only mock interaction above is the bus subscribe.)
      expect(store.put).not.toHaveBeenCalled();
    });

    it('terminal failure path: provider.login throws and the worker journals `failed` and transitions the durable half to failed', async () => {
      // The SDK-throw branch in `handleFreshStart`: provider.login
      // rejects, the worker's `try/catch` routes through
      // `markTerminalFailure` which appends `failed` to the journal
      // and transitions the durable half. The `failed` event
      // surfaces on a subsequent `getStatus` poll (covered by the
      // service spec's orphan-recovery tests against the same
      // shape).
      const sessionId = 'failure-session';
      const failureError = new Error('provider rejected the code');
      const provider = makeThrowingProvider(failureError);
      const resolverMock = createMockResolver(
        provider as unknown as OAuthProviderInterface,
      );
      worker = createWorker({
        store,
        bus,
        resolver: resolverMock,
        instrumentation,
      });
      await seedPendingDurable(store, sessionId);

      const { job, updateProgressSpy } = makeJob({
        sessionId,
        piProviderId: 'anthropic',
      });

      await worker.process(job);

      // `provider.login` was called once (the fresh-start path
      // attempts the SDK before catching the throw).
      expect(provider.login).toHaveBeenCalledTimes(1);

      // The journal's terminal event is `failed` with the
      // provider-side error message.
      const lastJournal = updateProgressSpy.mock.calls.at(
        -1,
      )?.[0] as OAuthLoginJobJournal;
      expect(lastJournal).toBeDefined();
      const lastEvent = lastJournal.events.at(-1);
      expect(lastEvent?.type).toBe('failed');
      if (lastEvent?.type === 'failed') {
        expect(lastEvent.message).toBe(failureError.message);
      }

      // The durable half transitioned to `failed` with the same
      // error message.
      const putCalls = store.put.mock.calls;
      const failedWrite = putCalls.find(
        ([, state]) => (state as OAuthSessionState).status === 'failed',
      );
      expect(failedWrite).toBeDefined();
      expect((failedWrite?.[1] as OAuthSessionState).error).toBe(
        failureError.message,
      );
    });
  });
});
