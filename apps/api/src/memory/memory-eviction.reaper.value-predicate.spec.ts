/**
 * Unit tests for the usefulness-aware EVICTION parity
 * (EPIC-212 Phase-3 Task 3).
 *
 * The contract under test:
 *   1. With `eviction_value_predicate_enabled=true`, an idle
 *      low-access row the shared retention predicate KEEPS
 *      (high usefulness / pinned / injected-and-helped) is SKIPPED —
 *      never evicted — while a low-usefulness idle row is deleted.
 *   2. With the flag off (the default), eviction is BYTE-IDENTICAL to
 *      today: every candidate is deleted, the feedback service is
 *      never consulted, and the usefulness batch is never computed.
 *   3. Fail-soft: a feedback-service throw (or an absent feedback
 *      dependency) degrades to "evict as today" — no throw.
 *
 * The existing `memory-eviction.reaper.spec.ts` is the default-off
 * regression suite; this file exercises the flag-on path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { MemoryEvictionReaperService } from './memory-eviction.reaper';
import { MemorySegmentEvictionRepository } from './database/repositories/memory-segment.eviction.repository';
import { MemorySegmentCrudRepository } from './database/repositories/memory-segment.crud.repository';
import type { MemorySegment } from './database/entities/memory-segment.entity';
import { MemorySegmentFeedbackService } from './memory-segment-feedback.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import {
  MEMORY_SEGMENT_EVICTION_MAX_IDLE_DAYS,
  MEMORY_SEGMENT_EVICTION_MIN_ACCESS_COUNT,
  MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES,
} from '../settings/learning-settings.constants';
import {
  DEFAULT_MAX_IDLE_DAYS,
  DEFAULT_MIN_ACCESS_COUNT,
  DEFAULT_PROTECTED_SOURCES,
} from './memory-eviction.constants';
import {
  EVICTION_VALUE_PREDICATE_ENABLED_SETTING,
  MEMORY_DECAY_USEFULNESS_MIN_SAMPLES_SETTING,
  MEMORY_DECAY_USEFULNESS_THRESHOLD_SETTING,
} from '../settings/memory-decay-value.settings.constants';

type SegmentUsefulness = { usefulness: number | null; sampleSize: number };

interface MockRepo {
  findEvictionCandidates: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

interface MockFeedback {
  computeUsefulnessForSegments: ReturnType<typeof vi.fn>;
}

const NOW = new Date('2026-06-26T12:00:00.000Z');

function buildSegment(overrides: Partial<MemorySegment>): MemorySegment {
  return {
    id: overrides.id ?? 'segment-id',
    entity_type: 'project.memory',
    entity_id: 'project-1',
    memory_type: 'fact',
    content: 'content',
    version: 1,
    metadata_json: null,
    last_accessed_at: null,
    access_count: 0,
    pinned: false,
    source: 'project.memory',
    last_reinforced_at: null,
    archived_at: null,
    drift_detected_at: null,
    governance_state: null,
    supersedes: null,
    superseded_by: null,
    syncSourceFromMetadata: () => undefined,
    created_at: new Date('2025-01-01T00:00:00.000Z'),
    updated_at: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function configureSettings(
  settings: { get: ReturnType<typeof vi.fn> },
  values: { evictionPredicateEnabled?: boolean },
): void {
  settings.get.mockImplementation(((key: string, defaultValue: unknown) => {
    if (key === MEMORY_SEGMENT_EVICTION_MAX_IDLE_DAYS) {
      return Promise.resolve(DEFAULT_MAX_IDLE_DAYS);
    }
    if (key === MEMORY_SEGMENT_EVICTION_MIN_ACCESS_COUNT) {
      return Promise.resolve(DEFAULT_MIN_ACCESS_COUNT);
    }
    if (key === MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES) {
      return Promise.resolve(DEFAULT_PROTECTED_SOURCES.join(','));
    }
    if (key === EVICTION_VALUE_PREDICATE_ENABLED_SETTING) {
      return Promise.resolve(values.evictionPredicateEnabled ?? false);
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

async function buildModule(
  repo: MockRepo,
  settings: { get: ReturnType<typeof vi.fn> },
  feedback: MockFeedback | null,
): Promise<TestingModule> {
  const providers: Provider[] = [
    MemoryEvictionReaperService,
    { provide: MemorySegmentEvictionRepository, useValue: repo },
    { provide: MemorySegmentCrudRepository, useValue: repo },
    { provide: SystemSettingsService, useValue: settings },
    {
      provide: EventLedgerService,
      useValue: { emitBestEffort: vi.fn().mockResolvedValue(undefined) },
    },
  ];
  if (feedback !== null) {
    providers.push({
      provide: MemorySegmentFeedbackService,
      useValue: feedback,
    });
  }
  return Test.createTestingModule({ providers }).compile();
}

/** Two idle, never-touched, low-access rows old enough to evict. */
function idleEvictableRows(): MemorySegment[] {
  return [
    buildSegment({
      id: 'useful-idle',
      last_accessed_at: null,
      access_count: 0,
    }),
    buildSegment({ id: 'low-idle', last_accessed_at: null, access_count: 0 }),
  ];
}

function usefulnessMap(): Map<string, SegmentUsefulness> {
  return new Map<string, SegmentUsefulness>([
    ['useful-idle', { usefulness: 0.9, sampleSize: 5 }],
    ['low-idle', { usefulness: 0.1, sampleSize: 5 }],
  ]);
}

describe('MemoryEvictionReaperService — value predicate (Phase-3 Task 3)', () => {
  let repo: MockRepo;
  let settings: { get: ReturnType<typeof vi.fn> };
  let feedback: MockFeedback;

  beforeEach(() => {
    repo = {
      findEvictionCandidates: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    settings = { get: vi.fn() };
    feedback = { computeUsefulnessForSegments: vi.fn() };
  });

  it('skips a high-usefulness idle low-access row and deletes the low-usefulness one when the flag is on', async () => {
    repo.findEvictionCandidates.mockResolvedValue(idleEvictableRows());
    feedback.computeUsefulnessForSegments.mockResolvedValue(usefulnessMap());
    configureSettings(settings, { evictionPredicateEnabled: true });

    const moduleRef = await buildModule(repo, settings, feedback);
    const reaper = moduleRef.get(MemoryEvictionReaperService);

    const summary = await reaper.runOnce({ now: NOW });

    expect(feedback.computeUsefulnessForSegments).toHaveBeenCalledTimes(1);
    expect(feedback.computeUsefulnessForSegments).toHaveBeenCalledWith(
      ['useful-idle', 'low-idle'],
      NOW,
    );
    expect(summary.scanned).toBe(2);
    expect(summary.evicted).toBe(1);
    expect(summary.skipped).toBe(1);
    // Only the low-usefulness row was deleted; the useful one is kept.
    expect(repo.remove).toHaveBeenCalledTimes(1);
    expect(repo.remove).toHaveBeenCalledWith('low-idle');
    expect(repo.remove).not.toHaveBeenCalledWith('useful-idle');
  });

  it('is byte-identical to today (deletes BOTH rows, never consults feedback) when the flag is off', async () => {
    repo.findEvictionCandidates.mockResolvedValue(idleEvictableRows());
    configureSettings(settings, { evictionPredicateEnabled: false });

    const moduleRef = await buildModule(repo, settings, feedback);
    const reaper = moduleRef.get(MemoryEvictionReaperService);

    const summary = await reaper.runOnce({ now: NOW });

    expect(feedback.computeUsefulnessForSegments).not.toHaveBeenCalled();
    expect(summary.scanned).toBe(2);
    expect(summary.evicted).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(repo.remove).toHaveBeenCalledWith('useful-idle');
    expect(repo.remove).toHaveBeenCalledWith('low-idle');
  });

  it('degrades to evict-as-today when the feedback service throws (flag on, fail-soft)', async () => {
    repo.findEvictionCandidates.mockResolvedValue(idleEvictableRows());
    feedback.computeUsefulnessForSegments.mockRejectedValue(
      new Error('feedback DB blip'),
    );
    configureSettings(settings, { evictionPredicateEnabled: true });

    const moduleRef = await buildModule(repo, settings, feedback);
    const reaper = moduleRef.get(MemoryEvictionReaperService);

    const summary = await reaper.runOnce({ now: NOW });

    // No usefulness → no keep set → both rows evicted as today.
    expect(summary.evicted).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(repo.remove).toHaveBeenCalledWith('useful-idle');
    expect(repo.remove).toHaveBeenCalledWith('low-idle');
  });

  it('degrades to evict-as-today when the feedback dependency is absent (flag on, fail-soft)', async () => {
    repo.findEvictionCandidates.mockResolvedValue(idleEvictableRows());
    configureSettings(settings, { evictionPredicateEnabled: true });

    const moduleRef = await buildModule(repo, settings, null);
    const reaper = moduleRef.get(MemoryEvictionReaperService);

    const summary = await reaper.runOnce({ now: NOW });

    expect(summary.evicted).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(repo.remove).toHaveBeenCalledWith('useful-idle');
    expect(repo.remove).toHaveBeenCalledWith('low-idle');
  });
});
