import { afterEach, describe, expect, it, vi } from 'vitest';

import { classifyWorkflowFailure } from './workflow-failure-classification.helpers';

describe('classifyWorkflowFailure', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('classifies provider rate limits separately from overloads with retry metadata', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T14:00:00Z'));

    expect(
      classifyWorkflowFailure({
        reason:
          '429 usage limit exceeded, 5-hour usage limit reached for Token Plan Starter (1500/1500 used), resets at 2026-04-29T15:00:00Z',
        providerOverloadDelayMs: 18_000_000,
        rateLimitResetBufferMs: 60_000,
      }),
    ).toMatchObject({
      reasonCode: 'provider_rate_limit_429',
      retryCategory: 'provider_rate_limit_429',
      retryDelayMsOverride: 3_660_000,
      resetAt: '2026-04-29T15:00:00.000Z',
      providerTier: 'Token Plan Starter',
      usageLimit: { used: 1500, limit: 1500, unit: 'tokens' },
    });
  });
});

describe('classifyWorkflowFailure — transport timeout', () => {
  const base = { providerOverloadDelayMs: 1000, rateLimitResetBufferMs: 1000 };

  it('classifies provider abort finish reasons explicitly', () => {
    const result = classifyWorkflowFailure({
      reason: 'Provider finish_reason: abort',
      ...base,
    });

    expect(result.reasonCode).toBe('provider_finish_reason_abort');
    expect(result.retryCategory).toBe('default');
  });

  it('classifies an /execute/agent POST timeout as agent_transport_timeout', () => {
    const result = classifyWorkflowFailure({
      reason: 'HTTP POST timed out: http://172.18.0.10:8374/execute/agent',
      ...base,
    });
    expect(result.reasonCode).toBe('agent_transport_timeout');
  });

  it('classifies a socket hang up / ECONNRESET as agent_transport_timeout', () => {
    const result = classifyWorkflowFailure({
      reason:
        'request to http://172.18.0.10:8374/execute/agent failed, reason: socket hang up (ECONNRESET)',
      ...base,
    });
    expect(result.reasonCode).toBe('agent_transport_timeout');
  });

  it('classifies a 504 gateway timeout as agent_transport_timeout', () => {
    const result = classifyWorkflowFailure({
      reason:
        '504 The request timed out while processing. Please try again later. (2066)',
      ...base,
    });
    expect(result.reasonCode).toBe('agent_transport_timeout');
  });

  it('leaves an unrelated error as generic_failure', () => {
    const result = classifyWorkflowFailure({
      reason: 'something else broke',
      ...base,
    });
    expect(result.reasonCode).toBe('generic_failure');
  });
});

describe('classifyWorkflowFailure — container loss', () => {
  const base = { providerOverloadDelayMs: 1000 };

  it('classifies an execution container exit/loss as container_lost', () => {
    const result = classifyWorkflowFailure({
      reason: 'Execution container exited or was lost',
      ...base,
    });
    expect(result.reasonCode).toBe('container_lost');
    expect(result.retryCategory).toBe('default');
  });

  it('classifies a stale-run watchdog stall as container_lost', () => {
    const result = classifyWorkflowFailure({
      reason:
        'Run stalled: RUNNING with no active or queued step job (stale-run watchdog)',
      ...base,
    });
    expect(result.reasonCode).toBe('container_lost');
  });

  it('classifies a job_failed_after_retries stall wrapper as container_lost', () => {
    const result = classifyWorkflowFailure({
      reason:
        'job_failed_after_retries: Run stalled: RUNNING with no active or queued step job (stale-run watchdog)',
      ...base,
    });
    expect(result.reasonCode).toBe('container_lost');
  });
});

describe('classifyWorkflowFailure — resource contention', () => {
  const base = { providerOverloadDelayMs: 1000 };

  it('classifies lane-capacity exhaustion as resource_contention', () => {
    const result = classifyWorkflowFailure({
      reason:
        'MCP HTTP request failed (-32000): lane_capacity_exhausted — lane "mutation_queue" is full',
      ...base,
    });
    expect(result.reasonCode).toBe('resource_contention');
    expect(result.retryCategory).toBe('resource_contention');
  });

  it('classifies a conflicting lease as resource_contention', () => {
    const result = classifyWorkflowFailure({
      reason: 'Mutation blocked — conflicting lease(s) held: resource:a9a08b37',
      ...base,
    });
    expect(result.reasonCode).toBe('resource_contention');
  });
});
