import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryContradictionService } from './memory-contradiction.service';
import { MemorySegmentCrudRepository } from '../database/repositories/memory-segment.crud.repository';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import { MEMORY_CONTRADICTION_ENABLED_SETTING } from '../../settings/memory-contradiction.settings.constants';
import type { ICandidateSimilarity } from '../signals/candidate-similarity.interface';
import type { ContradictionEvaluationInput } from './memory-contradiction.types';

const NEW_SEGMENT_ID = 'new-seg';
const EXISTING_SEGMENT_ID = 'existing-seg';

function input(
  overrides: Partial<ContradictionEvaluationInput> = {},
): ContradictionEvaluationInput {
  return {
    segmentId: NEW_SEGMENT_ID,
    content: 'Always run migrations before deploy',
    scopeType: 'project',
    scopeId: 'scope-1',
    version: 1,
    ...overrides,
  };
}

describe('MemoryContradictionService', () => {
  const similarity = {
    findNearest: vi.fn(),
    findRawSimilarNeighbors: vi.fn(),
  };
  const memorySegments = {
    findByEntity: vi.fn(),
    update: vi.fn(),
  };
  const eventLedger = {
    emitBestEffort: vi.fn(),
  };
  const settingsStore = new Map<string, unknown>();
  const settings = {
    get: vi.fn(async (key: string, defaultValue: unknown) =>
      settingsStore.has(key) ? settingsStore.get(key) : defaultValue,
    ),
  };

  let service: MemoryContradictionService;

  function buildService(): MemoryContradictionService {
    return new MemoryContradictionService(
      similarity,
      memorySegments as unknown as MemorySegmentCrudRepository,
      eventLedger as unknown as EventLedgerService,
      settings as unknown as SystemSettingsService,
    );
  }

  function seedExisting(content: string): void {
    memorySegments.findByEntity.mockResolvedValue([
      { id: EXISTING_SEGMENT_ID, content, superseded_by: null, version: 1 },
      { id: NEW_SEGMENT_ID, content: 'irrelevant', superseded_by: null },
    ]);
  }

  function seedNeighbour(score: number): void {
    similarity.findNearest.mockResolvedValue([
      { ownerType: 'memory_segment', ownerId: EXISTING_SEGMENT_ID, score },
    ]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    settingsStore.clear();
    eventLedger.emitBestEffort.mockResolvedValue(undefined);
    memorySegments.update.mockResolvedValue(null);
    service = buildService();
  });

  it('is a no-op when memory_contradiction_enabled is false', async () => {
    const decision = await service.evaluate(input());

    expect(decision.kind).toBe('none');
    expect(decision.reason).toBe('disabled');
    expect(memorySegments.findByEntity).not.toHaveBeenCalled();
    expect(similarity.findNearest).not.toHaveBeenCalled();
    expect(memorySegments.update).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
  });

  it('supersedes (enforce) a near opposing-stance contradiction', async () => {
    settingsStore.set('memory_contradiction_enabled', true);
    settingsStore.set('memory_contradiction_mode', 'enforce');
    seedExisting('Never run migrations before deploy');
    seedNeighbour(0.93);

    const decision = await service.evaluate(input());

    expect(decision.kind).toBe('supersede');
    expect(decision.existingSegmentId).toBe(EXISTING_SEGMENT_ID);
    // new segment links forward to the one it replaced
    expect(memorySegments.update).toHaveBeenCalledWith(NEW_SEGMENT_ID, {
      supersedes: EXISTING_SEGMENT_ID,
    });
    // existing loser is linked back + archived for audit
    const existingUpdate = memorySegments.update.mock.calls.find(
      ([id]) => id === EXISTING_SEGMENT_ID,
    );
    expect(existingUpdate).toBeDefined();
    expect(existingUpdate?.[1]).toMatchObject({
      superseded_by: NEW_SEGMENT_ID,
    });
    expect(existingUpdate?.[1].archived_at).toBeInstanceOf(Date);
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: AUTONOMY_EVENT_NAMES.memoryContradictionDetected,
        payload: expect.objectContaining({
          kind: 'supersede',
          mode: 'enforce',
          applied: true,
        }),
      }),
    );
  });

  it('versions (enforce) a near refinement', async () => {
    settingsStore.set('memory_contradiction_enabled', true);
    settingsStore.set('memory_contradiction_mode', 'enforce');
    seedExisting(
      'Always run migrations before deploy especially for schema changes',
    );
    seedNeighbour(0.9);

    const decision = await service.evaluate(input());

    expect(decision.kind).toBe('version');
    expect(memorySegments.update).toHaveBeenCalledWith(NEW_SEGMENT_ID, {
      supersedes: EXISTING_SEGMENT_ID,
      version: 2,
    });
    // a version never archives the existing row
    const archivedExisting = memorySegments.update.mock.calls.find(
      ([id, data]) => id === EXISTING_SEGMENT_ID && 'archived_at' in data,
    );
    expect(archivedExisting).toBeUndefined();
  });

  it('emits an ambiguous event and preserves both rows', async () => {
    settingsStore.set('memory_contradiction_enabled', true);
    settingsStore.set('memory_contradiction_mode', 'enforce');
    seedExisting('Cache eviction policy is LRU');
    seedNeighbour(0.9);

    const decision = await service.evaluate(
      input({ content: 'The cache layer behaves oddly under heavy load' }),
    );

    expect(decision.kind).toBe('ambiguous');
    expect(memorySegments.update).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ kind: 'ambiguous', applied: false }),
      }),
    );
  });

  it('returns none for a near same-stance dedup', async () => {
    settingsStore.set('memory_contradiction_enabled', true);
    settingsStore.set('memory_contradiction_mode', 'enforce');
    seedExisting('Always run migrations before deploy');
    seedNeighbour(0.99);

    const decision = await service.evaluate(input());

    expect(decision.kind).toBe('none');
    expect(decision.reason).toBe('same_stance_dedup');
    expect(memorySegments.update).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
  });

  it('returns none when the nearest neighbour is below threshold', async () => {
    settingsStore.set('memory_contradiction_enabled', true);
    seedExisting('Never run migrations before deploy');
    seedNeighbour(0.4);

    const decision = await service.evaluate(input());

    expect(decision.kind).toBe('none');
    expect(decision.reason).toBe('no_near_candidate');
    expect(memorySegments.update).not.toHaveBeenCalled();
  });

  it('shadow mode emits the event but mutates nothing', async () => {
    settingsStore.set('memory_contradiction_enabled', true);
    settingsStore.set('memory_contradiction_mode', 'shadow');
    seedExisting('Never run migrations before deploy');
    seedNeighbour(0.93);

    const decision = await service.evaluate(input());

    expect(decision.kind).toBe('supersede');
    expect(memorySegments.update).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ mode: 'shadow', applied: false }),
      }),
    );
  });

  it('fails soft to none when vector search throws', async () => {
    settingsStore.set('memory_contradiction_enabled', true);
    memorySegments.findByEntity.mockResolvedValue([
      { id: EXISTING_SEGMENT_ID, content: 'x', superseded_by: null },
    ]);
    similarity.findNearest.mockRejectedValue(new Error('boom'));

    const decision = await service.evaluate(input());

    expect(decision.kind).toBe('none');
    expect(decision.reason).toBe('error');
    expect(memorySegments.update).not.toHaveBeenCalled();
  });

  it('returns none when there are no other in-scope segments', async () => {
    settingsStore.set('memory_contradiction_enabled', true);
    memorySegments.findByEntity.mockResolvedValue([
      { id: NEW_SEGMENT_ID, content: 'x', superseded_by: null },
    ]);

    const decision = await service.evaluate(input());

    expect(decision.kind).toBe('none');
    expect(decision.reason).toBe('no_scope_candidates');
    expect(similarity.findNearest).not.toHaveBeenCalled();
  });
});

describe('workflow-scoped segments (Epic C regression pin)', () => {
  it('scopes contradiction detection to the workflow entity pool', async () => {
    const settings = {
      get: vi.fn(async (key: string, fallback: unknown) =>
        key === MEMORY_CONTRADICTION_ENABLED_SETTING ? true : fallback,
      ),
    };
    const findByEntity = vi.fn().mockResolvedValue([
      {
        id: 'existing-wf',
        content: 'always run nest build',
        superseded_by: null,
      },
    ]);
    const similarity = {
      findNearest: vi.fn().mockResolvedValue([]),
      findRawSimilarNeighbors: vi.fn().mockResolvedValue([]),
    };
    const eventLedger = { emitBestEffort: vi.fn() };
    const service = new MemoryContradictionService(
      similarity,
      { findByEntity } as unknown as MemorySegmentRepository,
      eventLedger as unknown as EventLedgerService,
      settings as unknown as SystemSettingsService,
    );

    const decision = await service.evaluateCreatedSegment({
      id: 'new-wf',
      content: 'never run tsc directly',
      entity_type: 'workflow',
      entity_id: 'implementation-workflow',
      version: 1,
    });

    expect(findByEntity).toHaveBeenCalledWith(
      'workflow',
      'implementation-workflow',
    );
    expect(decision.kind).toBe('none'); // no near neighbour → no contradiction
  });
});
