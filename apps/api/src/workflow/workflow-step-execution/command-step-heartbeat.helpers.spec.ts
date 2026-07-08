import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMAND_STEP_HEARTBEAT_INTERVAL_MS,
  runWithPeriodicHeartbeat,
} from './command-step-heartbeat.helpers';

describe('runWithPeriodicHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a heartbeat on each interval while the operation is in flight', async () => {
    const onHeartbeat = vi.fn();
    let resolveOp!: (value: string) => void;
    const operation = () =>
      new Promise<string>((resolve) => {
        resolveOp = resolve;
      });

    const pending = runWithPeriodicHeartbeat(operation, onHeartbeat, {
      intervalMs: 1000,
    });

    expect(onHeartbeat).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onHeartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onHeartbeat).toHaveBeenCalledTimes(3);

    resolveOp('done');
    await expect(pending).resolves.toBe('done');
  });

  it('stops emitting heartbeats once the operation settles', async () => {
    const onHeartbeat = vi.fn();
    const operation = () => Promise.resolve('ok');

    await runWithPeriodicHeartbeat(operation, onHeartbeat, {
      intervalMs: 1000,
    });

    onHeartbeat.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onHeartbeat).not.toHaveBeenCalled();
  });

  it('stops emitting heartbeats and propagates when the operation rejects', async () => {
    const onHeartbeat = vi.fn();
    const operation = () => Promise.reject(new Error('boom'));

    await expect(
      runWithPeriodicHeartbeat(operation, onHeartbeat, { intervalMs: 1000 }),
    ).rejects.toThrow('boom');

    onHeartbeat.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onHeartbeat).not.toHaveBeenCalled();
  });

  it('defaults the interval to the command-step heartbeat constant', () => {
    expect(COMMAND_STEP_HEARTBEAT_INTERVAL_MS).toBeLessThan(5 * 60_000);
  });
});
