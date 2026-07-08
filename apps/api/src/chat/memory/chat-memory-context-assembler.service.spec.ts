import { describe, expect, it, vi } from 'vitest';
import { ChatMemoryContextAssemblerService } from './chat-memory-context-assembler.service';

/**
 * Build a no-op `MemoryTokenBudgetResolver` mock. The existing
 * spec tests always supply an explicit `tokenBudget` on the input
 * so the resolver path is bypassed; we just need a non-null
 * reference to satisfy the M3 / M3 constructor.
 */
function makeResolverMock(): {
  resolve: ReturnType<typeof vi.fn>;
} {
  return {
    resolve: vi.fn().mockResolvedValue({
      contextWindow: 200_000,
      memory: 120_000,
      working: 60_000,
      reserved: 20_000,
      memoryPercent: 60,
      workingPercent: 30,
      reservedPercent: 10,
    }),
  };
}

describe('ChatMemoryContextAssemblerService', () => {
  it('returns ranked memory slices and updates retrieval metrics', async () => {
    const sessionMemory = {
      findRecentBySession: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          memory_type: 'history',
          content: 'The user said the release is blocked by QA.',
          normalized_content: 'the user said the release is blocked by qa',
          importance_score: 85,
          created_at: new Date('2026-04-13T10:00:00.000Z'),
        },
      ]),
    };
    const profileMemory = {
      findActiveByProfile: vi.fn().mockResolvedValue([
        {
          id: 'profile-1',
          memory_type: 'preference',
          content: 'Prefers concise execution summaries.',
          normalized_content: 'prefers concise execution summaries',
          confidence_score: 90,
          updated_at: new Date('2026-04-13T09:00:00.000Z'),
        },
      ]),
      touchAccessed: vi.fn().mockResolvedValue(undefined),
    };
    const metrics = {
      recordRetrieval: vi.fn(),
    };

    const service = new ChatMemoryContextAssemblerService(
      sessionMemory as never,
      profileMemory as never,
      metrics as never,
      makeResolverMock() as never,
    );

    const context = await service.assembleContext({
      chatSessionId: 'chat-1',
      profileId: 'profile-1',
      prompt: 'Give me a concise summary of release blockers.',
      tokenBudget: 300,
      maxSlices: 3,
    });

    expect(context.retrieval.hitCount).toBeGreaterThan(0);
    expect(context.slices.some((slice) => slice.memoryId === 'session-1')).toBe(
      true,
    );
    expect(profileMemory.touchAccessed).toHaveBeenCalledWith(['profile-1']);
    expect(metrics.recordRetrieval).toHaveBeenCalledWith(context.slices.length);
  });

  it('returns an empty result when no memory candidates match', async () => {
    const service = new ChatMemoryContextAssemblerService(
      {
        findRecentBySession: vi.fn().mockResolvedValue([]),
      } as never,
      {
        findActiveByProfile: vi.fn().mockResolvedValue([]),
        touchAccessed: vi.fn().mockResolvedValue(undefined),
      } as never,
      {
        recordRetrieval: vi.fn(),
      } as never,
      makeResolverMock() as never,
    );

    const context = await service.assembleContext({
      chatSessionId: 'chat-1',
      profileId: 'profile-1',
      prompt: 'hello',
      tokenBudget: 200,
      maxSlices: 2,
    });

    expect(context.slices).toEqual([]);
    expect(context.retrieval.hitCount).toBe(0);
  });
});
