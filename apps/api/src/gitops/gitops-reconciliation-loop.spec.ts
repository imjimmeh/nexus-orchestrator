import { describe, it, expect, vi } from 'vitest';
import { GitOpsReconciliationLoop } from './gitops-reconciliation-loop';

describe('GitOpsReconciliationLoop', () => {
  it('does not start when disabled', () => {
    const tick = vi.fn();
    const loop = new GitOpsReconciliationLoop({
      logger: { log: vi.fn(), warn: vi.fn() } as any,
      isEnabled: () => false,
      intervalMs: 1000,
      jitterMs: 0,
      runTick: tick,
    });
    loop.start();
    expect(tick).not.toHaveBeenCalled();
    loop.stop();
  });

  it('skips overlapping ticks while one is in flight', async () => {
    let resolveTick: () => void = () => {};
    const tick = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveTick = r;
        }),
    );
    const loop = new GitOpsReconciliationLoop({
      logger: { log: vi.fn(), warn: vi.fn() } as any,
      isEnabled: () => true,
      intervalMs: 1,
      jitterMs: 0,
      runTick: tick,
    });
    await (loop as any).runTickGuarded();
    void (loop as any).runTickGuarded(); // overlapping second call
    expect(tick).toHaveBeenCalledTimes(1);
    resolveTick();
    loop.stop();
  });

  it('schedules the next tick within the [intervalMs, intervalMs + jitterMs) envelope', () => {
    // Capture every delay passed to setTimeout across multiple
    // scheduleNext() invocations so the test exercises the
    // jitter math, not just a single sample.
    const capturedDelays: number[] = [];
    // Deterministic pseudo-random generator that exercises
    // the full envelope by stepping through 0, ~0.5, and ~1.0.
    // Each value is strictly < 1 so `Math.floor` can never
    // reach `jitterMs` itself, keeping the envelope
    // half-open at the upper bound.
    const sampleSequence = [0, 0.5, 0.9999];
    let cursor = 0;
    const deterministicRandom = (): number => {
      const sample = sampleSequence[cursor % sampleSequence.length] ?? 0;
      cursor += 1;
      return sample;
    };

    const fakeTimer = { unref: () => undefined } as unknown as NodeJS.Timeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((...args: unknown[]) => {
        const delayArg = args[1];
        if (typeof delayArg === 'number') {
          capturedDelays.push(delayArg);
        }
        return fakeTimer;
      });

    const tick = vi.fn().mockResolvedValue(undefined);
    const loop = new GitOpsReconciliationLoop({
      logger: { log: vi.fn(), warn: vi.fn() } as any,
      isEnabled: () => true,
      intervalMs: 1000,
      jitterMs: 250,
      random: deterministicRandom,
      runTick: tick,
    });

    // Drive several scheduleNext() calls directly so the test
    // does not depend on real timers firing. Each invocation
    // re-enters scheduleNext() with the next random sample.
    (loop as unknown as { scheduleNext: () => void }).scheduleNext();
    (loop as unknown as { scheduleNext: () => void }).scheduleNext();
    (loop as unknown as { scheduleNext: () => void }).scheduleNext();

    expect(capturedDelays).toHaveLength(3);
    for (const delay of capturedDelays) {
      // Envelope: [intervalMs, intervalMs + jitterMs)
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThan(1250);
    }
    // The jitter must actually vary across iterations — a
    // constant offset would indicate the random source is not
    // wired into scheduleNext().
    const distinctDelays = new Set(capturedDelays);
    expect(distinctDelays.size).toBeGreaterThan(1);

    setTimeoutSpy.mockRestore();
    loop.stop();
  });
});
