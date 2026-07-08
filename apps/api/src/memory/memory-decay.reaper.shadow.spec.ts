/**
 * Unit tests for the SHADOW-mode wiring of the
 * MemoryDecayReaperService (EPIC-212 Phase-3 Task 2).
 *
 * The contract under test:
 *   1. In `shadow` mode the DB mutation set is BYTE-IDENTICAL to
 *      `legacy` — the value predicate observes but never changes which
 *      rows are archived.
 *   2. A `memory.decay.shadow.v1` event is emitted listing the
 *      useful-but-stale row as a "value-predicate KEEP / legacy
 *      ARCHIVE" divergence; a never-voted row appears in NEITHER
 *      special set.
 *   3. A feedback-service throw in `shadow` mode degrades to `legacy`
 *      (no throw, no shadow emit, identical mutations).
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
import { AUTONOMY_EVENT_NAMES } from '../observability/autonomy-observability.types';

const NOW = new Date('2026-06-26T12:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type SegmentUsefulness = { usefulness: number | null; sampleSize: number };

interface Mocks {
  repo: {
    findDecayCandidates: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
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
      findById: vi.fn().mockResolvedValue(null),
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
 * rate, 0.2 floor → applyDecay clamps to 0 < 0.2 → archived):
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

describe('MemoryDecayReaperService — shadow mode (Phase-3 Task 2)', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = buildMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('archives the SAME rows in shadow mode as in legacy mode (byte-identical DB mutations)', async () => {
    // Legacy pass.
    const legacyMocks = buildMocks();
    legacyMocks.repo.findDecayCandidates.mockResolvedValue(
      staleArchivableRows(),
    );
    configureSettings(legacyMocks.settings, 'legacy');
    const legacyModule = await buildModule(legacyMocks);
    const legacyReaper = legacyModule.get(MemoryDecayReaperService);
    const legacySummary = await legacyReaper.runDecayPass({ now: NOW });

    // Shadow pass with the value predicate active.
    mocks.repo.findDecayCandidates.mockResolvedValue(staleArchivableRows());
    mocks.feedback.computeUsefulnessForSegments.mockResolvedValue(
      usefulnessMap(),
    );
    configureSettings(mocks.settings, 'shadow');
    const shadowModule = await buildModule(mocks);
    const shadowReaper = shadowModule.get(MemoryDecayReaperService);
    const shadowSummary = await shadowReaper.runDecayPass({ now: NOW });

    // Identical run summary.
    expect(shadowSummary).toEqual(legacySummary);
    expect(shadowSummary).toEqual({
      evaluated: 3,
      decayed: 0,
      archived: 3,
      skipped: false,
    });

    // Identical archive set — the useful row is STILL archived in
    // shadow mode (the predicate observes but does not protect).
    expect(archivedIds(mocks.repo)).toEqual(archivedIds(legacyMocks.repo));
    expect(archivedIds(mocks.repo)).toEqual([
      'low-stale',
      'never-voted',
      'useful-stale',
    ]);
    expect(mocks.repo.save).not.toHaveBeenCalled();
  });

  it('emits memory.decay.shadow.v1 listing the useful-but-stale row as the value-keep / legacy-archive divergence', async () => {
    mocks.repo.findDecayCandidates.mockResolvedValue(staleArchivableRows());
    mocks.feedback.computeUsefulnessForSegments.mockResolvedValue(
      usefulnessMap(),
    );
    configureSettings(mocks.settings, 'shadow');
    const moduleRef = await buildModule(mocks);
    const reaper = moduleRef.get(MemoryDecayReaperService);

    await reaper.runDecayPass({ now: NOW });

    expect(mocks.feedback.computeUsefulnessForSegments).toHaveBeenCalledTimes(
      1,
    );
    expect(mocks.feedback.computeUsefulnessForSegments).toHaveBeenCalledWith(
      ['useful-stale', 'low-stale', 'never-voted'],
      NOW,
    );

    expect(mocks.eventLedger.emitBestEffort).toHaveBeenCalledTimes(1);
    const event = mocks.eventLedger.emitBestEffort.mock.calls[0]?.[0] as {
      domain: string;
      eventName: string;
      payload: {
        mode: string;
        evaluated: number;
        legacy_archive_count: number;
        value_predicate_archive_count: number;
        kept_by_value_archived_by_legacy: string[];
        archived_by_value_kept_by_legacy: string[];
      };
    };

    expect(event.domain).toBe('memory');
    expect(event.eventName).toBe(AUTONOMY_EVENT_NAMES.memoryDecayShadow);
    expect(event.payload.mode).toBe('shadow');
    expect(event.payload.evaluated).toBe(3);
    expect(event.payload.legacy_archive_count).toBe(3);
    // The value predicate would archive everything legacy did EXCEPT
    // the useful row.
    expect(event.payload.value_predicate_archive_count).toBe(2);
    // The divergence the shadow window watches for.
    expect(event.payload.kept_by_value_archived_by_legacy).toEqual([
      'useful-stale',
    ]);
    // A never-voted row is in NEITHER special set.
    expect(event.payload.kept_by_value_archived_by_legacy).not.toContain(
      'never-voted',
    );
    expect(event.payload.archived_by_value_kept_by_legacy).toEqual([]);
  });

  it('degrades to legacy (no throw, no shadow emit) when the feedback service throws', async () => {
    mocks.repo.findDecayCandidates.mockResolvedValue(staleArchivableRows());
    mocks.feedback.computeUsefulnessForSegments.mockRejectedValue(
      new Error('feedback DB blip'),
    );
    configureSettings(mocks.settings, 'shadow');
    const moduleRef = await buildModule(mocks);
    const reaper = moduleRef.get(MemoryDecayReaperService);

    const summary = await reaper.runDecayPass({ now: NOW });

    // The pass still completes and archives identically to legacy.
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

  it('does not compute usefulness or emit a shadow event in legacy mode (zero overhead)', async () => {
    mocks.repo.findDecayCandidates.mockResolvedValue(staleArchivableRows());
    configureSettings(mocks.settings, 'legacy');
    const moduleRef = await buildModule(mocks);
    const reaper = moduleRef.get(MemoryDecayReaperService);

    await reaper.runDecayPass({ now: NOW });

    expect(mocks.feedback.computeUsefulnessForSegments).not.toHaveBeenCalled();
    expect(mocks.eventLedger.emitBestEffort).not.toHaveBeenCalled();
  });
});
