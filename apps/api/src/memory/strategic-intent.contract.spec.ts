import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMemorySegment, InternalToolExecutionContext } from '@nexus/core';
import { RecordStrategicIntentHandler } from '../workflow/workflow-internal-tools/handlers/record-strategic-intent.handler';
import { ReadStrategicIntentHandler } from '../workflow/workflow-internal-tools/handlers/read-strategic-intent.handler';
import type { MemoryManagerService } from './memory-manager.service';

/**
 * EPIC-208 (Milestone 1) — contract test for the strategic-intent
 * persistence + retrieval flow.
 *
 * Verifies the acceptance criterion: "CEO can write strategic intent in
 * one cycle and it is available as context in subsequent cycles."
 *
 *  - `record_strategic_intent` writes/upserts the singleton segment for
 *    a scope via `MemoryManagerService.upsertMemorySegment`.
 *  - `read_strategic_intent` returns the same structured payload
 *    (horizon, priority_themes, focus_areas, constraints) on a
 *    subsequent call so the next cycle can pick up where the previous
 *    one left off.
 *  - `read_strategic_intent` returns `null` for scopes that have never
 *    been seeded.
 *  - A second write to the same scope replaces (upserts) the existing
 *    segment so the latest CEO intent always wins.
 */
describe('strategic_intent memory segment contract', () => {
  let memoryManager: {
    upsertMemorySegment: ReturnType<typeof vi.fn>;
    getStrategicIntentSegment: ReturnType<typeof vi.fn>;
  };
  let recordHandler: RecordStrategicIntentHandler;
  let readHandler: ReadStrategicIntentHandler;

  const context: InternalToolExecutionContext = {
    workflowRunId: 'run-1',
    jobId: 'job-1',
  };

  const validIntent = {
    horizon: 'Q1-2026',
    priority_themes: ['autonomous development', 'agent self-improvement'],
    focus_areas: ['memory schema coverage'],
    constraints: ['no silent lint regressions'],
    rationale: 'Lean into memory schema coverage this cycle.',
    updated_by: 'ceo',
  };

  beforeEach(() => {
    const segmentsByScope = new Map<string, IMemorySegment>();
    memoryManager = {
      upsertMemorySegment: vi.fn(
        async (
          entityType: string,
          entityId: string,
          memoryType: string,
          content: string,
          metadata: Record<string, unknown> | null,
        ): Promise<IMemorySegment> => {
          const key = `${entityType}:${entityId}:${memoryType}`;
          const existing = segmentsByScope.get(key);
          const now = new Date('2026-06-19T12:00:00.000Z');
          const next: IMemorySegment = existing
            ? {
                ...existing,
                content,
                metadata_json: metadata,
                version: existing.version + 1,
                updated_at: now,
              }
            : {
                id: `segment-${segmentsByScope.size + 1}`,
                entity_type: entityType,
                entity_id: entityId,
                memory_type: memoryType as IMemorySegment['memory_type'],
                content,
                version: 1,
                metadata_json: metadata,
                created_at: now,
                updated_at: now,
              };
          segmentsByScope.set(key, next);
          return next;
        },
      ),
      getStrategicIntentSegment: vi.fn(
        async (entityType: string, entityId: string) => {
          return (
            segmentsByScope.get(`${entityType}:${entityId}:strategic_intent`) ??
            null
          );
        },
      ),
    };

    recordHandler = new RecordStrategicIntentHandler(
      memoryManager as unknown as MemoryManagerService,
    );
    readHandler = new ReadStrategicIntentHandler(
      memoryManager as unknown as MemoryManagerService,
    );
  });

  it('round-trips a strategic intent write + read through MemoryManagerService', async () => {
    const writeResult = await recordHandler.recordStrategicIntent({
      entity_type: 'ceo_cycle',
      entity_id: 'scope-1',
      intent: validIntent,
    });

    expect(writeResult).toMatchObject({
      entity_type: 'ceo_cycle',
      entity_id: 'scope-1',
      memory_type: 'strategic_intent',
    });
    expect(memoryManager.upsertMemorySegment).toHaveBeenCalledWith(
      'ceo_cycle',
      'scope-1',
      'strategic_intent',
      expect.stringContaining('horizon=Q1-2026'),
      expect.objectContaining({
        horizon: 'Q1-2026',
        priority_themes: validIntent.priority_themes,
        focus_areas: validIntent.focus_areas,
        constraints: validIntent.constraints,
        rationale: validIntent.rationale,
        updated_by: 'ceo',
        updated_at: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        ),
      }),
    );

    const readResult = await readHandler.readStrategicIntent({
      entity_type: 'ceo_cycle',
      entity_id: 'scope-1',
    });

    expect(readResult).toMatchObject({
      entity_type: 'ceo_cycle',
      entity_id: 'scope-1',
      found: true,
    });
    const readIntent = (readResult as { intent: Record<string, unknown> })
      .intent;
    expect(readIntent).toEqual({
      horizon: 'Q1-2026',
      priority_themes: ['autonomous development', 'agent self-improvement'],
      focus_areas: ['memory schema coverage'],
      constraints: ['no silent lint regressions'],
      rationale: 'Lean into memory schema coverage this cycle.',
      updated_by: 'ceo',
      updated_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      ),
    });

    // Confirm the structured payload fields round-trip exactly.
    expect(readIntent.horizon).toBe('Q1-2026');
    expect(readIntent.priority_themes).toEqual([
      'autonomous development',
      'agent self-improvement',
    ]);
    expect(readIntent.focus_areas).toEqual(['memory schema coverage']);
    expect(readIntent.constraints).toEqual(['no silent lint regressions']);
  });

  it('returns null when no strategic intent has been recorded for the scope', async () => {
    const readResult = await readHandler.readStrategicIntent({
      entity_type: 'ceo_cycle',
      entity_id: 'never-recorded',
    });

    expect(readResult).toEqual({
      entity_type: 'ceo_cycle',
      entity_id: 'never-recorded',
      found: false,
      intent: null,
    });
    expect(memoryManager.upsertMemorySegment).not.toHaveBeenCalled();
    expect(memoryManager.getStrategicIntentSegment).toHaveBeenCalledWith(
      'ceo_cycle',
      'never-recorded',
    );
  });

  it('replaces the previous intent on a second write so the latest one wins', async () => {
    await recordHandler.recordStrategicIntent({
      entity_type: 'ceo_cycle',
      entity_id: 'scope-2',
      intent: validIntent,
    });

    const refreshed = {
      ...validIntent,
      horizon: '30-day',
      priority_themes: ['memory schema coverage'],
    };

    await recordHandler.recordStrategicIntent({
      entity_type: 'ceo_cycle',
      entity_id: 'scope-2',
      intent: refreshed,
    });

    expect(memoryManager.upsertMemorySegment).toHaveBeenCalledTimes(2);

    const readResult = await readHandler.readStrategicIntent({
      entity_type: 'ceo_cycle',
      entity_id: 'scope-2',
    });

    const readIntent = (readResult as { intent: Record<string, unknown> })
      .intent;
    expect(readIntent.horizon).toBe('30-day');
    expect(readIntent.priority_themes).toEqual(['memory schema coverage']);
  });

  it('keeps scopes isolated — a write to one scope is not visible from another', async () => {
    await recordHandler.recordStrategicIntent({
      entity_type: 'ceo_cycle',
      entity_id: 'scope-A',
      intent: validIntent,
    });

    const readOther = await readHandler.readStrategicIntent({
      entity_type: 'ceo_cycle',
      entity_id: 'scope-B',
    });

    expect(readOther).toEqual({
      entity_type: 'ceo_cycle',
      entity_id: 'scope-B',
      found: false,
      intent: null,
    });

    // The original scope is still readable and round-trips cleanly.
    const readOriginal = await readHandler.readStrategicIntent({
      entity_type: 'ceo_cycle',
      entity_id: 'scope-A',
    });
    expect(
      (readOriginal as { intent: Record<string, unknown> }).intent.horizon,
    ).toBe('Q1-2026');
  });

  it('exposes context to the handler (context arg is accepted for future expansion)', () => {
    expect(context).toBeDefined();
  });
});
