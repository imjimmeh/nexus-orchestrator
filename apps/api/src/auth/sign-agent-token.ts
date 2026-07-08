import * as jwt from 'jsonwebtoken';
import { resolveAgentTokenTtl } from '../config/agent-token-ttl';

/**
 * Signs an agent JWT from the given claims. The lifetime defaults to
 * {@link resolveAgentTokenTtl} (env `AGENT_JWT_TTL`, default 24h) so every
 * mint site shares one configurable source of truth. This is the seam a
 * future token-refresh endpoint plugs into.
 */
export function signAgentToken(
  claims: Record<string, unknown>,
  jwtSecret: string,
  ttl: string = resolveAgentTokenTtl(),
): string {
  return jwt.sign(claims, jwtSecret, {
    expiresIn: ttl as jwt.SignOptions['expiresIn'],
  });
}
