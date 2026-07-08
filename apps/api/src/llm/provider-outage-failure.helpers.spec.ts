import { describe, it, expect } from 'vitest';
import { classifyProviderOutageFailure } from './provider-outage-failure.helpers';

describe('classifyProviderOutageFailure', () => {
  it.each([
    'HTTP 500 internal server error',
    '502 Bad Gateway',
    'status 503 Service Unavailable',
    'Error 529 overloaded',
  ])('flags %s as an outage', (msg) => {
    expect(classifyProviderOutageFailure(msg)).toEqual({ isOutage: true });
  });
  it('returns null for a 429 rate limit', () => {
    expect(
      classifyProviderOutageFailure('HTTP 429 rate limit reached'),
    ).toBeNull();
  });
  it('returns null for unrelated text', () => {
    expect(classifyProviderOutageFailure('out of extra usage')).toBeNull();
  });
});
