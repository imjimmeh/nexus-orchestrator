/**
 * Unit tests for the ENFORCE-mode wiring of the
 * MemoryDecayReaperService (EPIC-212 Phase-3 Task 3).
 *
 * The contract under test:
 *   1. In `enforce` mode the value predicate's `keep` verdict
 *      SHORT-CIRCUITS archival — a useful-but-stale row whose decayed
 *      confidence fell below the floor is PRESERVED (never archived),
 *      while a low-usefulness / never-voted stale row is archived
 *      exactly as legacy would.
 *   2. `MEMORY_DECAY_EXEMPT_SOURCES` remains a hard floor in `enforce`
 *      mode — an exempt-source row never decays regardless of the
 *      predicate.
 *   3. A feedback-service throw degrades to legacy (the useful row is
 *      archived again; no enforce protection, no throw).
 *
 * Uses Vitest mocks for every dependency — no live DB, no BullMQ.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { MemoryDecayReaperService } from './memory-decay.reaper';
import { MemorySegmentDecayRepository } from './database/repositories/memory-segment.decay.repository';
import { MemorySegmentCrudRepository } from './database/repositories/memory-segment.crud.repository';
import type { MemorySegment } from './database/entities/memory-segment.entity';
import { MemorySegmentFeedbackService } from './memory-segment-feedback.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import { MemoryMetricsService } from './memory-metrics.service';
import { MetricsService } from '../observability/metrics.service';
import { MEMORY_DECAY_SETTING_KEYS } from './memory-decay.constants';
import {
  DECAY_VALUE_PREDICATE_MODE_SETTING,
  MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_SETTING,
  MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING,
} from '../settings/memory-decay-value.settings.constants';

const NOW = new Date('2026-06-26T12:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type SegmentUsefulness = { usefulness: number | null; sampleSize: number };

interface Mocks {
  repo: {
    findDecayCandidates: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  settings: { get: ReturnType<typeof vi.fn> };
  memoryMetrics: { setMemoryDecayLastRun: ReturnType<typeof vi.fn> };
  promClient: { recordMemoryDecayRun: ReturnType<typeof vi.fn> };
  feedback: { computeUsefulnessForSegments: ReturnType<typeof vi.fn> };
  eventLedger: { emitBestEffort: ReturnType<typeof vi.fn> };
}

function buildSegment(overrides: Partial<MemorySegment>): MemorySegment {
  return {
    id: 'segment-id',
    entity_type: 'project.memory',
    entity_id: 'scope-1',
    memory_type: 'fact',
    content: 'content',
    version: 1,
    metadata_json: null,
    last_accessed_at: null,
    access_count: 0,
    pinned: false,
    source: 'general',
    last_reinforced_at: null,
    archived_at: null,
    drift_detected_at: null,
    governance_state: null,
    supersedes: null,
    superseded_by: null,
    syncSourceFromMetadata: () => undefined,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function configureSettings(
  settings: { get: ReturnType<typeof vi.fn> },
  mode: 'legacy' | 'shadow' | 'enforce',
): void {
  settings.get.mockImplementation(((key: string, defaultValue: unknown) => {
    if (key === MEMORY_DECAY_SETTING_KEYS.enabled) {
      return Promise.resolve(true);
    }
    if (key === DECAY_VALUE_PREDICATE_MODE_SETTING) {
      return Promise.resolve(mode);
    }
    if (key === MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING) {
      return Promise.resolve(0.6);
    }
    if (key === MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_SETTING) {
      return Promise.resolve(3);
    }
    return Promise.resolve(defaultValue);
  }) as never);
}

async function buildModule(mocks: Mocks): Promise<TestingModule> {
  const providers: Provider[] = [
    MemoryDecayReaperService,
    { provide: MemorySegmentDecayRepository, useValue: mocks.repo },
    { provide: MemorySegmentCrudRepository, useValue: mocks.repo },
    { provide: SystemSettingsService, useValue: mocks.settings },
    { provide: MemoryMetricsService, useValue: mocks.memoryMetrics },
    { provide: MetricsService, useValue: mocks.promClient },
    { provide: MemorySegmentFeedbackService, useValue: mocks.feedback },
    { provide: EventLedgerService, useValue: mocks.eventLedger },
  ];
  return Test.createTestingModule({ providers }).compile();
}

function buildMocks(): Mocks {
  return {
    repo: {
      findDecayCandidates: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
      save: vi
        .fn()
        .mockImplementation((segment: MemorySegment) =>
          Promise.resolve(segment),
        ),
    },
    settings: { get: vi.fn() },
    memoryMetrics: { setMemoryDecayLastRun: vi.fn() },
    promClient: { recordMemoryDecayRun: vi.fn() },
    feedback: { computeUsefulnessForSegments: vi.fn() },
    eventLedger: { emitBestEffort: vi.fn().mockResolvedValue(undefined) },
  };
}

/**
 * Three rows that ALL fall below the floor under the default decay
 * math (confidence 0.15, 60 days past access, 30-day grace, 0.01
 * rate, 0.2 floor → applyDecay clamps to 0 < 0.2 → legacy archives):
 *   - useful-stale: high usefulness, enough votes → value KEEP.
 *   - low-stale:    low usefulness, enough votes → value archive.
 *   - never-voted:  no votes → value archive (no_votes).
 */
function staleArchivableRows(): MemorySegment[] {
  return [
    buildSegment({
      id: 'useful-stale',
      last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
      metadata_json: { confidence: 0.15 },
    }),
    buildSegment({
      id: 'low-stale',
      last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
      metadata_json: { confidence: 0.15 },
    }),
    buildSegment({
      id: 'never-voted',
      last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
      metadata_json: { confidence: 0.15 },
    }),
  ];
}

function usefulnessMap(): Map<string, SegmentUsefulness> {
  return new Map<string, SegmentUsefulness>([
    ['useful-stale', { usefulness: 0.9, sampleSize: 5 }],
    ['low-stale', { usefulness: 0.1, sampleSize: 5 }],
    ['never-voted', { usefulness: null, sampleSize: 0 }],
  ]);
}

function archivedIds(repo: Mocks['repo']): string[] {
  return repo.update.mock.calls.map((call) => call[0] as string).sort();
}

describe('MemoryDecayReaperService — enforce mode (Phase-3 Task 3)', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = buildMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('KEEPS a high-usefulness stale row that legacy archives, and ARCHIVES the low-usefulness / never-voted rows', async () => {
    mocks.repo.findDecayCandidates.mockResolvedValue(staleArchivableRows());
    mocks.feedback.computeUsefulnessForSegments.mockResolvedValue(
      usefulnessMap(),
    );
    configureSettings(mocks.settings, 'enforce');
    const moduleRef = await buildModule(mocks);
    const reaper = moduleRef.get(MemoryDecayReaperService);

    const summary = await reaper.runDecayPass({ now: NOW });

    // The useful row is preserved; only the two low-value rows archive.
    expect(summary).toEqual({
      evaluated: 2,
      decayed: 0,
      archived: 2,
      skipped: false,
    });
    expect(archivedIds(mocks.repo)).toEqual(['low-stale', 'never-voted']);
    // The useful-but-stale row was never archived.
    expect(archivedIds(mocks.repo)).not.toContain('useful-stale');
    // Preserving a row never persists a decayed confidence either.
    expect(mocks.repo.save).not.toHaveBeenCalled();
  });

  it('legacy mode archives the SAME rows the enforce predicate would keep (proves the divergence is enforce-only)', async () => {
    mocks.repo.findDecayCandidates.mockResolvedValue(staleArchivableRows());
    configureSettings(mocks.settings, 'legacy');
    const moduleRef = await buildModule(mocks);
    const reaper = moduleRef.get(MemoryDecayReaperService);

    const summary = await reaper.runDecayPass({ now: NOW });

    // Legacy archives all three — including the useful row enforce keeps.
    expect(summary).toEqual({
      evaluated: 3,
      decayed: 0,
      archived: 3,
      skipped: false,
    });
    expect(archivedIds(mocks.repo)).toEqual([
      'low-stale',
      'never-voted',
      'useful-stale',
    ]);
    // Zero overhead in legacy mode: no usefulness batch, no shadow emit.
    expect(mocks.feedback.computeUsefulnessForSegments).not.toHaveBeenCalled();
    expect(mocks.eventLedger.emitBestEffort).not.toHaveBeenCalled();
  });

  it('never decays an exempt-source row in enforce mode (hard floor preserved)', async () => {
    const exemptStale = buildSegment({
      id: 'exempt-stale',
      source: 'learning_candidate',
      last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
      metadata_json: { confidence: 0.15 },
    });
    mocks.repo.findDecayCandidates.mockResolvedValue([exemptStale]);
    mocks.feedback.computeUsefulnessForSegments.mockResolvedValue(
      new Map<string, SegmentUsefulness>([
        ['exempt-stale', { usefulness: 0.1, sampleSize: 5 }],
      ]),
    );
    configureSettings(mocks.settings, 'enforce');
    const moduleRef = await buildModule(mocks);
    const reaper = moduleRef.get(MemoryDecayReaperService);

    const summary = await reaper.runDecayPass({ now: NOW });

    // The exempt row is skipped by the hard-floor classification — it
    // is neither decayed nor archived, even though its usefulness is
    // low and its confidence decayed below the floor.
    expect(summary).toEqual({
      evaluated: 0,
      decayed: 0,
      archived: 0,
      skipped: false,
    });
    expect(mocks.repo.update).not.toHaveBeenCalled();
    expect(mocks.repo.save).not.toHaveBeenCalled();
  });

  it('degrades to legacy (archives the useful row) when the feedback service throws in enforce mode', async () => {
    mocks.repo.findDecayCandidates.mockResolvedValue(staleArchivableRows());
    mocks.feedback.computeUsefulnessForSegments.mockRejectedValue(
      new Error('feedback DB blip'),
    );
    configureSettings(mocks.settings, 'enforce');
    const moduleRef = await buildModule(mocks);
    const reaper = moduleRef.get(MemoryDecayReaperService);

    const summary = await reaper.runDecayPass({ now: NOW });

    // No usefulness → no enforce protection → legacy archives all three.
    expect(summary).toEqual({
      evaluated: 3,
      decayed: 0,
      archived: 3,
      skipped: false,
    });
    expect(archivedIds(mocks.repo)).toEqual([
      'low-stale',
      'never-voted',
      'useful-stale',
    ]);
    // No shadow event when usefulness could not be computed.
    expect(mocks.eventLedger.emitBestEffort).not.toHaveBeenCalled();
  });

  it('keeps a pinned stale row in enforce mode even with no usefulness votes', async () => {
    const pinnedStale = buildSegment({
      id: 'pinned-stale',
      pinned: true,
      last_accessed_at: new Date(NOW.getTime() - 60 * MS_PER_DAY),
      metadata_json: { confidence: 0.15 },
    });
    mocks.repo.findDecayCandidates.mockResolvedValue([pinnedStale]);
    mocks.feedback.computeUsefulnessForSegments.mockResolvedValue(
      new Map<string, SegmentUsefulness>([
        ['pinned-stale', { usefulness: null, sampleSize: 0 }],
      ]),
    );
    configureSettings(mocks.settings, 'enforce');
    const moduleRef = await buildModule(mocks);
    const reaper = moduleRef.get(MemoryDecayReaperService);

    const summary = await reaper.runDecayPass({ now: NOW });

    expect(summary).toEqual({
      evaluated: 0,
      decayed: 0,
      archived: 0,
      skipped: false,
    });
    expect(mocks.repo.update).not.toHaveBeenCalled();
  });
});
