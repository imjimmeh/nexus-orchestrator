/**
 * Unit tests for {@link OAuthLoginService}'s producer-side orchestration
 * contract after the M3 migration from the legacy per-pod in-process
 * `Map<sessionId, ...>` to the BullMQ durable worker
 * (`apps/api/src/oauth/oauth-login.worker.ts`).
 *
 * The service's remaining responsibilities are:
 *
 *   1. **Producer-side enqueue** — `start(...)` validates the provider id,
 *      writes the initial pending durable Redis record, and enqueues the
 *      `OAUTH_LOGIN_RUN_JOB` BullMQ job that the worker consumes.
 *
 *   2. **Submit-code delivery** — `submitCode(...)` publishes to the
 *      bus channel the worker subscribes to. Worker-side callback
 *      wiring (publish-before-subscribe race guard, journal events,
 *      `provider.login` invocation) is exercised by
 *      `apps/api/src/oauth/oauth-login.worker.spec.ts`.
 *
 *   3. **Status + orphan-recovery** — `getStatus(...)` reads the durable
 *      half, applies the expired-state transition, and — for a
 *      `pending` session with a future `expiresAt` — queries the BullMQ
 *      queue (`loginQueue.getJobs`) to decide between "still in flight"
 *      and "orphaned by pod restart". The queue (not the per-pod
 *      `Map<sessionId, ...>`) is the source of truth after M3.
 *
 * What is NOT tested here (lives in the worker spec instead):
 *
 *   - The provider-side callback flow (`onAuth` / `onDeviceCode` /
 *     `onManualCodeInput`) — owned by the worker's
 *     `handleFreshStart` / `handleRehydration` branches.
 *   - The 20-second initiation-timeout — owned by the worker's
 *     `buildInitiationTimeout`.
 *   - Cross-pod code-channel delivery against a real Redis pub/sub —
 *     covered by `oauth-login.integration.spec.ts`.
 *
 * Why not `Test.createTestingModule` for the worker spec:
 *   See `apps/api/src/memory/memory-decay.processor.spec.ts` for the
 *   rationale; same pattern applies here.
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  createHarness,
  InMemoryOAuthLoginSessionStore,
  makeProvider,
} from './oauth-login.service.spec-helpers';

describe('OAuthLoginService', () => {
  it('rejects an unsupported provider before any state is written', async () => {
    // The state-machine guard in `start(...)` throws BEFORE writing the
    // pending durable record or enqueuing the worker job so a typo'd
    // `piProviderId` fails fast at the API edge.
    const { service } = await createHarness();
    await expect(
      service.start({ piProviderId: 'nope' }, async () => undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enqueues a BullMQ run-job on start and writes the durable pending record', async () => {
    // The producer-side test does not exercise `provider.login` — the
    // worker owns that side. A never-resolving `login` keeps the
    // service-level `start()` contract clear of any asynchronous
    // SDK side effects that the producer-side test would otherwise
    // have to microtask-drain.
    const provider = makeProvider(() => new Promise(() => undefined));
    const { service, store, loginQueue } = await createHarness({ provider });

    const result = await service.start(
      { piProviderId: 'anthropic' },
      async () => undefined,
    );

    expect(result.sessionId).toMatch(/^[0-9a-f-]+$/i);
    expect(result.modality).toBe('authcode');
    expect(result.expiresAt).toEqual(expect.any(String));

    // Durable record lands in the in-memory store with `pending` status
    // and a 900-second `expiresAt` — mirrors `SET ... EX 900`.
    const stored = await store.get(result.sessionId);
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe('pending');
    expect(new Date(stored?.expiresAt ?? 0).getTime()).toBeGreaterThan(
      Date.now() + 800_000,
    );

    // The producer's queue contract: a single `add(...)` call against
    // the `oauth-login` queue keyed by the sessionId, with
    // `attempts: 1` (per the worker trust model) and
    // `removeOnFail: false` (so a failed run leaves a forensic trail).
    expect(loginQueue.add).toHaveBeenCalledTimes(1);
    const [jobName, payload, options] =
      (loginQueue.add.mock.calls[0] as [string, unknown, unknown]) ?? [];
    expect(jobName).toBe('run');
    expect((payload as { sessionId: string }).sessionId).toBe(result.sessionId);
    expect((payload as { piProviderId: string }).piProviderId).toBe(
      'anthropic',
    );
    expect((options as { jobId: string; attempts: number }).jobId).toBe(
      result.sessionId,
    );
    expect((options as { jobId: string; attempts: number }).attempts).toBe(1);
  });

  it('throws when submitting a code for an unknown session', async () => {
    const { service } = await createHarness();
    await expect(service.submitCode('missing', 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws when submitting a code for a non-pending session', async () => {
    // The state-machine guard on `submitCode` rejects a paste when the
    // durable half is already `connected` / `failed` / `expired`.
    // Reaching the `BadRequestException` branch requires a known
    // sessionId — we seed the durable record directly so the producer
    // path is bypassed entirely and the test focuses on the submit
    // surface.
    const sessionId = 'already-connected';
    const sharedStore = new InMemoryOAuthLoginSessionStore();
    await sharedStore.put(sessionId, {
      id: sessionId,
      status: 'connected',
    });

    const { service } = await createHarness({ store: sharedStore });
    await expect(service.submitCode(sessionId, 'x')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws when fetching status for an unknown session', async () => {
    const { service } = await createHarness();
    await expect(service.getStatus('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('publishes to the bus channel on submitCode so the worker can deliver the code to its in-flight login', async () => {
    // `submitCode` is a thin wrapper around `sessionBus.publishCode`
    // (the worker — not the service — owns the subscriber side). The
    // service spec exercises only the producer side; the cross-pod
    // delivery contract is covered by the worker spec's rehydration
    // branch and by `oauth-login.integration.spec.ts` against real
    // Redis.
    const provider = makeProvider(() => new Promise(() => undefined));
    const { service, bus } = await createHarness({ provider });
    bus.publishCode = vi.fn().mockResolvedValue(undefined);

    const result = await service.start(
      { piProviderId: 'anthropic' },
      async () => undefined,
    );
    await service.submitCode(result.sessionId, 'PASTED');

    expect(bus.publishCode).toHaveBeenCalledTimes(1);
    expect(bus.publishCode).toHaveBeenCalledWith(result.sessionId, 'PASTED');
  });

  describe('orphan detection (M3 — queue-backed, not Map-backed)', () => {
    // After M3, the orphan-recovery branch in `getStatus` consults the
    // BullMQ queue directly via `loginQueue.getJobs(['active',
    // 'waiting', 'delayed'])`. The legacy per-pod Map is gone. These
    // tests pin both directions of the new decision: no live job →
    // orphan-recovery transition; live job → return `{ status:
    // 'pending' }` without firing the orphan branch.

    it('transitions a pending session with no live BullMQ job to failed (orphan recovery), surfaces session_taken_over_at, and DELs the durable key', async () => {
      // Default harness sets `loginQueue.getJobs` → `[]`, so the
      // orphan branch fires immediately on `getStatus` for a
      // future-expiry pending session.
      const sessionId = 'orphaned-session';
      const sharedStore = new InMemoryOAuthLoginSessionStore();
      await sharedStore.put(sessionId, { id: sessionId, status: 'pending' });

      const peeked = sharedStore.peek(sessionId);
      expect(peeked?.status).toBe('pending');
      expect(new Date(peeked?.expiresAt ?? 0).getTime()).toBeGreaterThan(
        Date.now(),
      );

      const { service, loginQueue, oauthMetrics } = await createHarness({
        store: sharedStore,
      });

      const status = await service.getStatus(sessionId);
      expect(status).toEqual({
        status: 'failed',
        error: 'OAuth session orphaned by pod restart',
        session_taken_over_at: expect.any(String),
      });

      // Secondary ISO-8601 timestamp freshness check: the
      // `session_taken_over_at` value returned alongside the
      // orphan-recovery transition MUST be a valid ISO-8601
      // timestamp minted within ±5s of `Date.now()`. The guard
      // logic (`durable.session_taken_over_at ??
      // new Date().toISOString()`) produces a fresh stamp on the
      // very first orphan-recovery transition because the
      // seeded orphan carries no pre-existing value, so this
      // check is the test-side witness that the branch picked
      // the `?? new Date().toISOString()` arm rather than
      // short-circuiting on a stale pre-seeded value. The
      // exactly-once preservation arm is covered by the
      // dedicated `'writes session_taken_over_at exactly once
      // ...'` test in the `orphan-recovery Prometheus counter`
      // describe block.
      expect(
        Math.abs(
          new Date(status.session_taken_over_at as string).getTime() -
            Date.now(),
        ) < 5000,
      ).toBe(true);

      // `getJobs` MUST have been queried exactly once with the three
      // pre-terminal job states — that is the source-of-truth lookup
      // the orphan branch keys off.
      expect(loginQueue.getJobs).toHaveBeenCalledTimes(1);
      expect(loginQueue.getJobs).toHaveBeenCalledWith([
        'active',
        'waiting',
        'delayed',
      ]);

      // The orphan-recovery counter fires exactly once (AC for
      // `b19758d8-2448-472a-b2db-3856d3f6b4bc`).
      expect(oauthMetrics.recordOAuthLoginOrphaned).toHaveBeenCalledTimes(1);

      // The orphan-recovery path explicitly DELs the Redis key, so the
      // next observer sees a clean not-found rather than a stranded
      // failed record.
      expect(sharedStore.peek(sessionId)).toBeUndefined();
      expect(await sharedStore.get(sessionId)).toBeNull();
    });

    it('returns { status: "pending" } without firing the orphan branch when a live BullMQ job exists for the sessionId', async () => {
      // The non-orphan path: a job matching `data.sessionId` is in the
      // queue's active/waiting/delayed set, so the orphan branch MUST
      // NOT transition the session to `failed` or fire the counter.
      const sessionId = 'live-session';
      const sharedStore = new InMemoryOAuthLoginSessionStore();
      await sharedStore.put(sessionId, { id: sessionId, status: 'pending' });

      const { service, loginQueue, oauthMetrics } = await createHarness({
        store: sharedStore,
      });
      // Override the harness's default empty-list stub with a single
      // job whose `data.sessionId` matches the session we're asking
      // about.
      loginQueue.getJobs.mockResolvedValueOnce([{ data: { sessionId } }]);

      const status = await service.getStatus(sessionId);
      expect(status).toEqual({ status: 'pending' });

      // The query happened, the counter did not.
      expect(loginQueue.getJobs).toHaveBeenCalledTimes(1);
      expect(oauthMetrics.recordOAuthLoginOrphaned).not.toHaveBeenCalled();

      // And the durable record was NOT touched — the store still has
      // the original `pending` payload and has NOT been DELed.
      const stillPending = await sharedStore.get(sessionId);
      expect(stillPending?.status).toBe('pending');
    });

    it('still treats pending without a `data.sessionId` match as orphaned (mismatched sessionId is treated as no live job)', async () => {
      // Defensive: a `getJobs` result that does NOT contain the
      // sessionId we're asking about must be treated as "no live
      // job for this session" — BullMQ-wide state isn't a positive
      // signal for the per-session check.
      const sessionId = 'match-required';
      const sharedStore = new InMemoryOAuthLoginSessionStore();
      await sharedStore.put(sessionId, { id: sessionId, status: 'pending' });

      const { service, loginQueue, oauthMetrics } = await createHarness({
        store: sharedStore,
      });
      loginQueue.getJobs.mockResolvedValueOnce([
        { data: { sessionId: 'some-other-session' } },
      ]);

      const status = await service.getStatus(sessionId);
      expect(status).toEqual({
        status: 'failed',
        error: 'OAuth session orphaned by pod restart',
        session_taken_over_at: expect.any(String),
      });

      expect(loginQueue.getJobs).toHaveBeenCalledTimes(1);
      expect(oauthMetrics.recordOAuthLoginOrphaned).toHaveBeenCalledTimes(1);
    });

    it('marks a pending session whose expiresAt is in the past as expired and DELs the durable key (expiry branch, NOT orphan branch)', async () => {
      // The expired-session branch fires BEFORE the queue-based
      // orphan check, so the queue MUST NOT be queried on this path
      // and the orphan-recovery counter MUST NOT increment.
      //
      // Use `seedExpired` (rather than `put`) because `put` rewrites
      // `expiresAt` to `now + 900s` on every call, mirroring Redis'
      // `SET ... EX` semantic. `seedExpired` preserves the explicit
      // past `expiresAt` so the expiry-branch fires rather than the
      // orphan-branch.
      const sessionId = 'expired-no-counter';
      const sharedStore = new InMemoryOAuthLoginSessionStore();
      await sharedStore.seedExpired(sessionId, { status: 'pending' });

      const { service, loginQueue, oauthMetrics } = await createHarness({
        store: sharedStore,
      });

      const status = await service.getStatus(sessionId);
      expect(status).toEqual({ status: 'expired' });

      // The expired-state branch DEL'd the key and short-circuited
      // before the orphan branch — so the queue stub was NEVER
      // queried (this test's harness builds the stub but expects
      // zero interactions) and the counter was NEVER incremented.
      expect(loginQueue.getJobs).not.toHaveBeenCalled();
      expect(oauthMetrics.recordOAuthLoginOrphaned).not.toHaveBeenCalled();
      expect(await sharedStore.get(sessionId)).toBeNull();
    });

    it('does not increment the counter on the not-found getStatus path (no durable record)', async () => {
      // Defensive check: a request for a sessionId that was never
      // `start()`-ed (no durable record at all) must not
      // accidentally trip the orphan branch. The early
      // `NotFoundException` short-circuits before either the queue
      // query or the orphan branch is reached.
      const { service, loginQueue, oauthMetrics } = await createHarness();

      await expect(service.getStatus('never-existed')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(loginQueue.getJobs).not.toHaveBeenCalled();
      expect(oauthMetrics.recordOAuthLoginOrphaned).not.toHaveBeenCalled();
    });

    it('increments the counter once per orphan-recovery transition when called repeatedly across distinct sessionIds', async () => {
      // Multiple distinct orphan transitions across multiple
      // sessionIds MUST each produce one increment. Sanity check
      // that the counter is per-transition (not per-pod, not
      // per-request, not deduplicated).
      const sharedStore = new InMemoryOAuthLoginSessionStore();
      for (const sessionId of ['orphan-a', 'orphan-b', 'orphan-c']) {
        await sharedStore.put(sessionId, {
          id: sessionId,
          status: 'pending',
        });
      }

      const { service, oauthMetrics } = await createHarness({
        store: sharedStore,
      });

      for (const sessionId of ['orphan-a', 'orphan-b', 'orphan-c']) {
        const status = await service.getStatus(sessionId);
        expect(status.status).toBe('failed');
      }

      expect(oauthMetrics.recordOAuthLoginOrphaned).toHaveBeenCalledTimes(3);
    });

    // The HEAD-side spec already covers the
    // `'does not increment the counter on the not-found
    // getStatus path'` invariant via the queue-aware variant
    // above (it asserts both the queue query and the counter
    // spy are untouched). origin/main's no-queue duplicate is
    // therefore redundant and is intentionally dropped from
    // the merged spec.

    it('writes session_taken_over_at exactly once per session lifecycle on the orphan-recovery path', async () => {
      // Exactly-once invariant (work item
      // `ffb22b91-6047-4e6d-a345-2ff537376b61` Milestone 5):
      //
      //   - First orphan-recovery transition for a session:
      //     the durable record carries NO `session_taken_over_at`
      //     yet, so the guard `durable.session_taken_over_at ??
      //     new Date().toISOString()` mints a fresh ISO-8601
      //     stamp and returns it to the caller.
      //   - Subsequent orphan-recovery transitions for the SAME
      //     session (e.g. a polling caller hitting `getStatus`
      //     again on a record whose `DEL` is still in flight, or
      //     a stale read between the `writeDurable` and
      //     `deleteDurable` calls in the orphan branch): the
      //     durable record already carries a `session_taken_over_at`
      //     value, and the guard preserves that value verbatim
      //     rather than overwriting it with a fresh
      //     `new Date().toISOString()`. This keeps the timestamp
      //     anchored to the very first takeover so dashboards and
      //     audit logs see a single, immutable orphan-recovery
      //     timestamp per session lifecycle.
      //
      // The test exercises both arms of the guard against a single
      // shared in-memory store. The two sessionIds are used so the
      // first `getStatus` call's `DEL` (which removes the durable
      // key entirely) does not make the second call's pre-seeded
      // payload disappear before `readDurable` runs.
      const sharedStore = new InMemoryOAuthLoginSessionStore();

      // --- Arm 1: first orphan-recovery transition mints a fresh stamp. ---
      const firstSessionId = 'orphan-exactly-once-first';
      await sharedStore.put(firstSessionId, {
        id: firstSessionId,
        status: 'pending',
      });

      const { service } = await createHarness({ store: sharedStore });

      const firstStatus = await service.getStatus(firstSessionId);
      expect(firstStatus.status).toBe('failed');
      expect(typeof firstStatus.session_taken_over_at).toBe('string');
      // Fresh-stamp arm: the minted value is within ±5s of
      // `Date.now()`. This is the same freshness invariant the
      // dedicated orphan-recovery test (above) asserts; here it
      // doubles as the witness that arm 1 actually walked the
      // `?? new Date().toISOString()` path.
      expect(
        Math.abs(
          new Date(firstStatus.session_taken_over_at as string).getTime() -
            Date.now(),
        ) < 5000,
      ).toBe(true);

      // --- Arm 2: pre-stamped orphan preserves the existing stamp. ---
      // Use a fixed, easily-recognisable ISO-8601 value that is
      // demonstrably NOT a fresh `new Date().toISOString()` (it is
      // years in the past relative to `Date.now()`). If the guard
      // ever regresses to "always mint a fresh stamp" this
      // assertion fires immediately because the returned value
      // would be within ±5s of `Date.now()` rather than equal to
      // the pre-seeded constant.
      const preStampedAt = '2020-01-01T00:00:00.000Z';
      const secondSessionId = 'orphan-exactly-once-second';
      await sharedStore.put(secondSessionId, {
        id: secondSessionId,
        status: 'pending',
        session_taken_over_at: preStampedAt,
      });

      const secondStatus = await service.getStatus(secondSessionId);
      expect(secondStatus.status).toBe('failed');
      // Exactly-once preservation arm: the returned
      // `session_taken_over_at` MUST equal the pre-seeded
      // constant. It MUST NOT be a fresh `new Date().toISOString()`
      // minted at the call site — that would re-anchor the
      // timestamp on every orphan-recovery transition and break
      // the invariant.
      expect(secondStatus.session_taken_over_at).toBe(preStampedAt);

      // Belt-and-braces: also confirm the pre-seeded value is
      // observably OLD so a future refactor that silently swaps
      // the guard for `new Date().toISOString()` cannot hide
      // behind "well, the value happens to match by coincidence"
      // — the assertion above compares against a constant that is
      // six years in the past, so any fresh stamp would diverge
      // from it by roughly `6 * 365 * 86_400_000` ms.
      expect(
        Math.abs(
          new Date(secondStatus.session_taken_over_at as string).getTime() -
            Date.now(),
        ) >= 5000,
      ).toBe(true);
    });
  });
});
