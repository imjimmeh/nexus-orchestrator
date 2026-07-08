import { describe, expect, it } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { signAgentToken } from './sign-agent-token';

const SECRET = 'test-secret';

describe('signAgentToken', () => {
  it('signs the provided claims and is verifiable with the secret', () => {
    const token = signAgentToken(
      { sub: 'agent:run:job', role: 'agent' },
      SECRET,
    );
    const decoded = jwt.verify(token, SECRET) as Record<string, unknown>;
    expect(decoded.sub).toBe('agent:run:job');
    expect(decoded.role).toBe('agent');
    expect(typeof decoded.exp).toBe('number');
  });

  it('uses the default TTL (~24h) when none is supplied', () => {
    const token = signAgentToken({ sub: 's' }, SECRET);
    const decoded = jwt.verify(token, SECRET) as { iat: number; exp: number };
    // 24h = 86400s, allow a couple seconds of signing skew.
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(86_400 - 5);
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(86_400 + 5);
  });

  it('honours an explicit ttl override', () => {
    const token = signAgentToken({ sub: 's' }, SECRET, '1h');
    const decoded = jwt.verify(token, SECRET) as { iat: number; exp: number };
    expect(decoded.exp - decoded.iat).toBe(3_600);
  });
});
