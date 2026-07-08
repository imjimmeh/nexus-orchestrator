import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectStateDigestProvider } from './project-state-digest.provider';
import { ChatSession } from '../../chat/database/entities/chat-session.entity';
import type { MemoryManagerService } from '../memory-manager.service';
import type { IMemorySegment } from '@nexus/core';

/**
 * Vitest unit tests for `ProjectStateDigestProvider`.
 *
 * The provider depends only on `MemoryManagerService` (cross-module via
 * the `forwardRef` cycle resolved in M2), so the tests instantiate it
 * directly with a `vi.fn()` mock — same pattern used by
 * `memory-listing.service.spec.ts`, `strategic-intent.contract.spec.ts`,
 * and the controller specs that inject `MemoryManagerService` directly.
 *
 * Coverage:
 *   (a) `canProvide` returns false when `scopeId` is null.
 *   (b) `canProvide` returns false when `getStrategicIntentSegment`
 *       returns null (no strategic intent recorded for the scope).
 *   (c) `getContext` renders horizon, priority_themes, focus_areas,
 *       constraints, and rationale from a fixture `metadata_json`.
 */
describe('ProjectStateDigestProvider', () => {
  const getStrategicIntentSegment = vi.fn();

  let provider: ProjectStateDigestProvider;

  function buildSession(overrides: Partial<ChatSession> = {}): ChatSession {
    return {
      id: 'sess-1',
      agent_profile_id: 'ap-1',
      agent_profile_name: 'agent-1',
      initial_message: 'hi',
      status: 'RUNNING' as ChatSession['status'],
      container_tier: 2,
      source: 'ad_hoc' as ChatSession['source'],
      session_type: 'general' as ChatSession['session_type'],
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    } as ChatSession;
  }

  function buildStrategicIntentSegment(
    metadataJson: Record<string, unknown> | null,
    overrides: Partial<IMemorySegment> = {},
  ): IMemorySegment {
    return {
      id: 'seg-intent-1',
      entity_type: 'Project',
      entity_id: 'scope-1',
      memory_type: 'strategic_intent',
      content: 'horizon=Q3 2026',
      version: 1,
      metadata_json: metadataJson,
      created_at: new Date('2026-06-19T12:00:00.000Z'),
      updated_at: new Date('2026-06-19T12:00:00.000Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ProjectStateDigestProvider({
      getStrategicIntentSegment,
    } as unknown as MemoryManagerService);
  });

  it('returns false from canProvide when scopeId is null', async () => {
    const session = buildSession({ scopeId: null });

    const result = await provider.canProvide(session);

    expect(result).toBe(false);
    expect(getStrategicIntentSegment).not.toHaveBeenCalled();
  });

  it('returns false from canProvide when MemoryManagerService reports no strategic intent for the scope', async () => {
    const session = buildSession({ scopeId: 'scope-1' });
    getStrategicIntentSegment.mockResolvedValue(null);

    const result = await provider.canProvide(session);

    expect(result).toBe(false);
    expect(getStrategicIntentSegment).toHaveBeenCalledTimes(1);
    expect(getStrategicIntentSegment).toHaveBeenCalledWith(
      'Project',
      'scope-1',
    );
  });

  it('renders horizon, priority_themes, focus_areas, constraints, and rationale in the markdown block', async () => {
    const session = buildSession({ scopeId: 'scope-1' });
    const fixtureMetadata = {
      horizon: 'Q3 2026',
      priority_themes: ['stability', 'perf'],
      focus_areas: ['api'],
      constraints: ['budget'],
      rationale: 'because',
    };
    getStrategicIntentSegment.mockResolvedValue(
      buildStrategicIntentSegment(fixtureMetadata),
    );

    const applicable = await provider.canProvide(session);
    expect(applicable).toBe(true);

    const block = await provider.getContext(session);

    expect(block.title).toBe('Project State Digest');
    expect(block.priority).toBe(200);
    expect(block.content).toContain('## Project State Digest');
    expect(block.content).toContain('- **Horizon**: Q3 2026');
    expect(block.content).toContain('- **Priority themes**: stability, perf');
    expect(block.content).toContain('- **Focus areas**: api');
    expect(block.content).toContain('- **Constraints**: budget');
    expect(block.content).toContain('- **Rationale**: because');
    expect(block.metadata).toEqual(
      expect.objectContaining({
        source: 'project-state-digest',
        provider: 'project-state-digest',
        cacheTtlSeconds: 300,
      }),
    );
  });
});
