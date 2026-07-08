import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type { OAuthLoginSessionDurable } from './oauth-login.types';
import { OAuthLoginSessionStore } from './oauth-login-session.store';

const FIXTURE_PAYLOAD: OAuthLoginSessionDurable = {
  id: 'sess-1',
  status: 'pending',
  modality: 'device',
  userCode: 'WXYZ-1234',
  verificationUri: 'https://verify.example/device',
  intervalSeconds: 5,
  authorizeUrl: 'https://authorize.example/sess-1',
  instructions: 'Visit the URL and enter the code',
  expiresAt: '2026-06-30T12:15:00.000Z',
};

describe('OAuthLoginSessionStore', () => {
  let store: OAuthLoginSessionStore;

  const redisMock = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    pttl: vi.fn().mockResolvedValue(-2),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthLoginSessionStore,
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();

    store = module.get<OAuthLoginSessionStore>(OAuthLoginSessionStore);
  });

  it('should be defined', () => {
    expect(store).toBeDefined();
  });

  describe('put', () => {
    it('should serialize the payload and write with the default 900s TTL', async () => {
      await store.put('sess-1', FIXTURE_PAYLOAD);

      expect(redisMock.set).toHaveBeenCalledTimes(1);
      expect(redisMock.set).toHaveBeenCalledWith(
        'oauth:session:sess-1',
        JSON.stringify(FIXTURE_PAYLOAD),
        'EX',
        900,
      );
    });

    it('should accept a custom TTL override', async () => {
      await store.put('sess-2', FIXTURE_PAYLOAD, 60);

      expect(redisMock.set).toHaveBeenCalledWith(
        'oauth:session:sess-2',
        JSON.stringify(FIXTURE_PAYLOAD),
        'EX',
        60,
      );
    });

    it('should refresh the TTL on every put for the same sessionId', async () => {
      await store.put('sess-3', FIXTURE_PAYLOAD);
      await store.put('sess-3', { ...FIXTURE_PAYLOAD, status: 'connected' });
      await store.put('sess-3', { ...FIXTURE_PAYLOAD, status: 'expired' });

      expect(redisMock.set).toHaveBeenCalledTimes(3);
      // Every call resets the TTL clock — `SET ... EX 900` overwrites
      // both the value and the expiry.
      for (const call of redisMock.set.mock.calls) {
        expect(call[0]).toBe('oauth:session:sess-3');
        expect(call[2]).toBe('EX');
        expect(call[3]).toBe(900);
      }
    });

    it('should key each sessionId under the oauth:session namespace', async () => {
      await store.put('alpha', FIXTURE_PAYLOAD);
      await store.put('beta', FIXTURE_PAYLOAD);

      expect(redisMock.set).toHaveBeenNthCalledWith(
        1,
        'oauth:session:alpha',
        JSON.stringify(FIXTURE_PAYLOAD),
        'EX',
        900,
      );
      expect(redisMock.set).toHaveBeenNthCalledWith(
        2,
        'oauth:session:beta',
        JSON.stringify(FIXTURE_PAYLOAD),
        'EX',
        900,
      );
    });
  });

  describe('get', () => {
    it('should return null when no record exists', async () => {
      redisMock.get.mockResolvedValueOnce(null);

      const result = await store.get('sess-missing');

      expect(result).toBeNull();
      expect(redisMock.get).toHaveBeenCalledWith('oauth:session:sess-missing');
    });

    it('should parse the JSON payload back into OAuthLoginSessionDurable', async () => {
      redisMock.get.mockResolvedValueOnce(JSON.stringify(FIXTURE_PAYLOAD));

      const result = await store.get('sess-1');

      expect(result).toEqual(FIXTURE_PAYLOAD);
      expect(redisMock.get).toHaveBeenCalledWith('oauth:session:sess-1');
    });

    it('should round-trip a pending session through serialization', async () => {
      const persisted: OAuthLoginSessionDurable = {
        id: 'sess-rt',
        status: 'pending',
        expiresAt: '2026-06-30T13:00:00.000Z',
      };
      redisMock.get.mockResolvedValueOnce(JSON.stringify(persisted));

      const result = await store.get('sess-rt');

      expect(result).toEqual(persisted);
      expect(result?.expiresAt).toBe('2026-06-30T13:00:00.000Z');
    });
  });

  describe('delete', () => {
    it('should remove the session key', async () => {
      await store.delete('sess-1');

      expect(redisMock.del).toHaveBeenCalledTimes(1);
      expect(redisMock.del).toHaveBeenCalledWith('oauth:session:sess-1');
    });

    it('should be safe to call for a missing sessionId', async () => {
      redisMock.del.mockResolvedValueOnce(0);

      await expect(store.delete('sess-gone')).resolves.toBeUndefined();
      expect(redisMock.del).toHaveBeenCalledWith('oauth:session:sess-gone');
    });
  });

  describe('expireAt', () => {
    it('should return null when the key has no TTL set (pttl === -1)', async () => {
      redisMock.pttl.mockResolvedValueOnce(-1);

      const result = await store.expireAt('sess-no-ttl');

      expect(result).toBeNull();
      expect(redisMock.pttl).toHaveBeenCalledWith('oauth:session:sess-no-ttl');
    });

    it('should return null when the key does not exist (pttl === -2)', async () => {
      redisMock.pttl.mockResolvedValueOnce(-2);

      const result = await store.expireAt('sess-missing');

      expect(result).toBeNull();
      expect(redisMock.pttl).toHaveBeenCalledWith('oauth:session:sess-missing');
    });

    it('should compute the absolute expiry from pttl and Date.now()', async () => {
      redisMock.pttl.mockResolvedValueOnce(450_000); // 7.5 minutes remaining

      const before = Date.now();
      const result = await store.expireAt('sess-1');
      const after = Date.now();

      expect(result).not.toBeNull();
      // The absolute expiry must fall within [before + 450_000, after + 450_000].
      // Allow a small fudge window for clock drift inside the test runner.
      const earliest = before + 450_000;
      const latest = after + 450_000;
      expect(result?.getTime()).toBeGreaterThanOrEqual(earliest);
      expect(result?.getTime()).toBeLessThanOrEqual(latest);
    });
  });
});
