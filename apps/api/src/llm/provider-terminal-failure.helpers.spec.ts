import { describe, expect, it } from 'vitest';

import { classifyProviderTerminalFailure } from './provider-terminal-failure.helpers';

describe('classifyProviderTerminalFailure', () => {
  it('classifies 402 insufficient balance as billing exhausted', () => {
    expect(classifyProviderTerminalFailure('402 Insufficient Balance')).toEqual(
      {
        reasonCode: 'provider_billing_exhausted',
      },
    );
  });

  it('classifies a subscription "out of extra usage" 400 as usage exhausted', () => {
    const message =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"You\'re out of extra usage. Add more at claude.ai/settings/usage and keep going."}}';

    expect(classifyProviderTerminalFailure(message)).toEqual({
      reasonCode: 'provider_usage_exhausted',
    });
  });

  it('classifies an authentication error as auth failed', () => {
    const message =
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';

    expect(classifyProviderTerminalFailure(message)).toEqual({
      reasonCode: 'provider_auth_failed',
    });
  });

  it('does NOT classify a retryable 429 usage limit as terminal', () => {
    const message =
      '429 usage limit exceeded, 5-hour usage limit reached for Token Plan Starter (1500/1500 used), resets at 2026-04-29T15:00:00Z';

    expect(classifyProviderTerminalFailure(message)).toBeNull();
  });

  it('does NOT classify a 529 provider overload as terminal', () => {
    expect(
      classifyProviderTerminalFailure(
        'Provider returned status code: 529 high traffic detected',
      ),
    ).toBeNull();
  });

  it('does NOT classify arbitrary text containing 402 as terminal', () => {
    expect(
      classifyProviderTerminalFailure(
        'workflow id abc402def failed validation',
      ),
    ).toBeNull();
  });

  it('returns null for a generic step failure', () => {
    expect(classifyProviderTerminalFailure('merge failed')).toBeNull();
  });
});
