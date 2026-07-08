import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@nestjs/common';
import { buildMemoryContextSafe } from './chat-messages.memory-helpers';

function createLogger(): Logger {
  return {
    warn: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  };
}

describe('buildMemoryContextSafe', () => {
  it('returns null without invoking the lifecycle when enabled=false', async () => {
    const logger = createLogger();
    const buildActionContext = vi.fn();

    const result = await buildMemoryContextSafe({
      memoryLifecycle: { buildActionContext } as never,
      logger,
      chatSessionId: 'chat-1',
      profileId: 'profile-1',
      prompt: 'hello',
      enabled: false,
    });

    expect(result).toBeNull();
    expect(buildActionContext).not.toHaveBeenCalled();
  });

  it('invokes the lifecycle and returns its result when enabled=true', async () => {
    const logger = createLogger();
    const expected = {
      retrieval: {
        retrievalId: 'ret-1',
        requestedAt: '2026-04-13T00:00:00.000Z',
        tokenBudget: 600,
        hitCount: 1,
        sessionHitCount: 1,
        profileHitCount: 0,
        consumedCharacters: 22,
      },
      slices: [],
    };
    const buildActionContext = vi.fn().mockResolvedValue(expected);

    const result = await buildMemoryContextSafe({
      memoryLifecycle: { buildActionContext } as never,
      logger,
      chatSessionId: 'chat-1',
      profileId: 'profile-1',
      prompt: 'hello',
      enabled: true,
    });

    expect(result).toBe(expected);
    expect(buildActionContext).toHaveBeenCalledWith({
      chatSessionId: 'chat-1',
      profileId: 'profile-1',
      prompt: 'hello',
    });
  });

  it('defaults to enabled when the flag is omitted (back-compat with P0)', async () => {
    const logger = createLogger();
    const buildActionContext = vi.fn().mockResolvedValue(null);

    const result = await buildMemoryContextSafe({
      memoryLifecycle: { buildActionContext } as never,
      logger,
      chatSessionId: 'chat-1',
      profileId: 'profile-1',
      prompt: 'hello',
    });

    expect(result).toBeNull();
    expect(buildActionContext).toHaveBeenCalledOnce();
  });

  it('swallows lifecycle errors and returns null when enabled', async () => {
    const logger = createLogger();
    const buildActionContext = vi.fn().mockRejectedValue(new Error('boom'));

    const result = await buildMemoryContextSafe({
      memoryLifecycle: { buildActionContext } as never,
      logger,
      chatSessionId: 'chat-1',
      profileId: 'profile-1',
      prompt: 'hello',
      enabled: true,
    });

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Memory context assembly failed for chat chat-1'),
    );
  });
});
