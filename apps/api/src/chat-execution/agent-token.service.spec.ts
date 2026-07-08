import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentTokenService } from './agent-token.service';
import * as jwt from 'jsonwebtoken';

describe('AgentTokenService', () => {
  let service: AgentTokenService;

  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', 'test-secret');
    service = new AgentTokenService();
  });

  it('returns a signed JWT with the expected sub field', () => {
    const token = service.mintAgentToken({
      chatSessionId: 'sess-1',
      agentProfileName: 'default',
    });
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded).toMatchObject({
      sub: 'agent:chat:sess-1',
      role: 'agent',
      chatSessionId: 'sess-1',
      agentProfileName: 'default',
    });
  });

  it('includes roles array in the payload', () => {
    const token = service.mintAgentToken({
      chatSessionId: 'sess-1',
      agentProfileName: 'default',
    });
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded['roles']).toEqual(['Agent']);
  });

  it('includes stepId matching chatSessionId', () => {
    const token = service.mintAgentToken({
      chatSessionId: 'sess-1',
      agentProfileName: 'default',
    });
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded['stepId']).toBe('sess-1');
  });

  it('includes scopeId when contextId is provided', () => {
    const token = service.mintAgentToken({
      chatSessionId: 'sess-1',
      agentProfileName: 'default',
      contextId: 'ctx-42',
    });
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded['scopeId']).toBe('ctx-42');
  });

  it('omits scopeId when contextId is not provided', () => {
    const token = service.mintAgentToken({
      chatSessionId: 'sess-1',
      agentProfileName: 'default',
    });
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded['scopeId']).toBeUndefined();
  });

  it('produces a token verifiable with the configured secret', () => {
    const token = service.mintAgentToken({
      chatSessionId: 'sess-1',
      agentProfileName: 'default',
    });
    expect(() => jwt.verify(token, 'test-secret')).not.toThrow();
  });

  it('produces a token that expires with the default 24h TTL', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = service.mintAgentToken({
      chatSessionId: 'sess-1',
      agentProfileName: 'default',
    });
    const decoded = jwt.decode(token) as Record<string, unknown>;
    const exp = decoded['exp'] as number;
    const iat = decoded['iat'] as number;
    expect(exp - iat).toBe(24 * 60 * 60);
    expect(iat).toBeGreaterThanOrEqual(before);
  });

  it('honours AGENT_JWT_TTL', () => {
    vi.stubEnv('AGENT_JWT_TTL', '1h');
    const token = service.mintAgentToken({
      chatSessionId: 'sess-1',
      agentProfileName: 'default',
    });
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect((decoded['exp'] as number) - (decoded['iat'] as number)).toBe(3_600);
  });
});
