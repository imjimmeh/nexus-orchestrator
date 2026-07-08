import { describe, it, expect, vi } from 'vitest';
import { maybeAdvanceFallback } from './step-agent-fallback-advance';

const E = (p: string, m: string) => ({ provider_name: p, model_name: m });
const base = {
  message: 'out of extra usage',
  primary: E('a', 'm1'),
  runId: 'run-1',
  failedJobId: 'job-1',
  now: new Date('2026-06-29T00:00:00Z'),
};

it('requeues and returns true when fallback handler says shouldRequeue', async () => {
  const fallback = {
    handleFailure: vi
      .fn()
      .mockResolvedValue({ shouldRequeue: true, reason: 'usage_exhausted' }),
  };
  const requeue = vi.fn().mockResolvedValue(undefined);
  const result = await maybeAdvanceFallback({
    ...base,
    enabled: true,
    fallback: fallback as never,
    requeue,
  });
  expect(requeue).toHaveBeenCalledWith(
    expect.objectContaining({ runId: 'run-1', failedJobId: 'job-1' }),
  );
  expect(result).toBe(true);
});

it('returns false without requeue when disabled', async () => {
  const fallback = { handleFailure: vi.fn() };
  const requeue = vi.fn();
  const result = await maybeAdvanceFallback({
    ...base,
    enabled: false,
    fallback: fallback as never,
    requeue,
  });
  expect(fallback.handleFailure).not.toHaveBeenCalled();
  expect(requeue).not.toHaveBeenCalled();
  expect(result).toBe(false);
});

it('returns false without requeue when no viable fallback remains', async () => {
  const fallback = {
    handleFailure: vi
      .fn()
      .mockResolvedValue({ shouldRequeue: false, reason: 'usage_exhausted' }),
  };
  const requeue = vi.fn();
  const result = await maybeAdvanceFallback({
    ...base,
    enabled: true,
    fallback: fallback as never,
    requeue,
  });
  expect(requeue).not.toHaveBeenCalled();
  expect(result).toBe(false);
});
