import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_TOKEN_TTL,
  resolveAgentTokenTtl,
} from './agent-token-ttl';

describe('resolveAgentTokenTtl', () => {
  const original = process.env.AGENT_JWT_TTL;

  beforeEach(() => {
    delete process.env.AGENT_JWT_TTL;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.AGENT_JWT_TTL;
    else process.env.AGENT_JWT_TTL = original;
  });

  it('returns the default when unset', () => {
    expect(resolveAgentTokenTtl()).toBe(DEFAULT_AGENT_TOKEN_TTL);
    expect(DEFAULT_AGENT_TOKEN_TTL).toBe('24h');
  });

  it('returns the configured value when valid', () => {
    process.env.AGENT_JWT_TTL = '36h';
    expect(resolveAgentTokenTtl()).toBe('36h');
  });

  it('accepts a plain integer seconds string', () => {
    process.env.AGENT_JWT_TTL = '7200';
    expect(resolveAgentTokenTtl()).toBe('7200');
  });

  it('falls back to default for an empty/whitespace value', () => {
    process.env.AGENT_JWT_TTL = '   ';
    expect(resolveAgentTokenTtl()).toBe(DEFAULT_AGENT_TOKEN_TTL);
  });

  it('throws for a malformed duration', () => {
    process.env.AGENT_JWT_TTL = 'banana';
    expect(() => resolveAgentTokenTtl()).toThrow(/AGENT_JWT_TTL/);
  });

  it('throws for a "1w" value (weeks are not in the supported unit set)', () => {
    // The legacy `DURATION_PATTERN` accepted `w` (weeks) as a unit, but
    // the canonical `parseDurationToSeconds` utility intentionally
    // restricts the unit set to `s|m|h|d`. This test pins the
    // behaviour-tightening: operators who previously set
    // `AGENT_JWT_TTL='1w'` now get a descriptive error naming the
    // offending value and the env var.
    process.env.AGENT_JWT_TTL = '1w';
    expect(() => resolveAgentTokenTtl()).toThrow(/AGENT_JWT_TTL.*"1w"/);
  });
});
