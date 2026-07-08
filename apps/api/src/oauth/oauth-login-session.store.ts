import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type { OAuthLoginSessionDurable } from './oauth-login.types';

const SESSION_KEY_PREFIX = 'oauth:session';
const DEFAULT_TTL_SECONDS = 900; // 15 minutes, matches OAuthLoginService.SESSION_TTL_MS

/**
 * Redis-backed store for the durable half of an in-flight OAuth login session.
 *
 * Owns the `oauth:session:{sessionId}` key namespace and enforces a 900-second
 * TTL via `SET ... EX`, mirroring the TTL semantics that the legacy in-process
 * periodic sweep previously enforced. Per-session writes refresh the TTL, so
 * an actively-progressing session never expires mid-flow.
 *
 * Only the durable fields of `LoginSession` (every field except
 * `AbortController` and the manual-code Promise resolver) are persisted here.
 * The transient primitives live in a per-pod in-memory map on
 * {@link OAuthLoginService} and are bound to the durable record by `sessionId`.
 *
 * See `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`
 * for the full architectural rationale.
 */
@Injectable()
export class OAuthLoginSessionStore {
  private readonly logger = new Logger(OAuthLoginSessionStore.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Persist (or overwrite) the durable half of a session and refresh its TTL.
   * Each call resets the 900-second clock so an actively-progressing session
   * is never reaped mid-flow.
   */
  async put(
    sessionId: string,
    durable: OAuthLoginSessionDurable,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    const key = this.buildKey(sessionId);
    await this.redis.set(key, JSON.stringify(durable), 'EX', ttlSeconds);
    this.logger.debug(`Stored OAuth session ${key} (TTL ${ttlSeconds}s)`);
  }

  /**
   * Fetch the durable half of a session. Returns `null` when the key has
   * expired or never existed — the caller is responsible for translating
   * `null` into the appropriate user-facing status (`expired` / not found).
   */
  async get(sessionId: string): Promise<OAuthLoginSessionDurable | null> {
    const key = this.buildKey(sessionId);
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as OAuthLoginSessionDurable;
  }

  /**
   * Remove the durable half of a session. No-op when the key is already gone.
   * Used on terminal status transitions (`connected` / `failed` / `expired`)
   * and by the orphan-recovery path described in the ADR.
   */
  async delete(sessionId: string): Promise<void> {
    const key = this.buildKey(sessionId);
    await this.redis.del(key);
  }

  /**
   * Absolute expiry timestamp of the durable record. Returns `null` when the
   * key has no TTL (`pttl` returns `-1`) or no longer exists (`pttl` returns
   * `-2`); both cases mean "no observable expiry" and the caller must fall
   * back to other signals (e.g. the `expiresAt` field on the durable payload).
   */
  async expireAt(sessionId: string): Promise<Date | null> {
    const key = this.buildKey(sessionId);
    const ttlMs = await this.redis.pttl(key);
    if (ttlMs < 0) {
      return null;
    }
    return new Date(Date.now() + ttlMs);
  }

  private buildKey(sessionId: string): string {
    return `${SESSION_KEY_PREFIX}:${sessionId}`;
  }
}
