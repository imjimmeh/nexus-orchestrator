import { describe, expect, it } from 'vitest';
import { WebAutomationPolicyService } from './web-automation-policy.service';

describe('WebAutomationPolicyService', () => {
  it('applies action defaults and request overrides', () => {
    const service = new WebAutomationPolicyService();

    const policy = service.resolvePolicy({
      action: 'click',
      session_id: 'default',
      timeout_ms: 2_500,
      retry_budget: 4,
      backoff_initial_ms: 100,
      backoff_factor: 1.5,
      backoff_max_ms: 500,
      pacing_ms: 20,
    });

    expect(policy).toEqual({
      timeout_ms: 2_500,
      retry_budget: 4,
      backoff_initial_ms: 100,
      backoff_factor: 1.5,
      backoff_max_ms: 500,
      pacing_ms: 20,
    });
  });

  it('computes exponential backoff with max cap', () => {
    const service = new WebAutomationPolicyService();

    const delay1 = service.computeBackoffDelayMs(
      {
        timeout_ms: 1_000,
        retry_budget: 3,
        backoff_initial_ms: 100,
        backoff_factor: 2,
        backoff_max_ms: 250,
        pacing_ms: 0,
      },
      1,
    );

    const delay2 = service.computeBackoffDelayMs(
      {
        timeout_ms: 1_000,
        retry_budget: 3,
        backoff_initial_ms: 100,
        backoff_factor: 2,
        backoff_max_ms: 250,
        pacing_ms: 0,
      },
      3,
    );

    expect(delay1).toBe(100);
    expect(delay2).toBe(250);
  });
});
