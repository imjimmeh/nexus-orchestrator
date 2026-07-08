/**
 * Unit tests for the drift-anchored self-invalidation wiring of the
 * MemoryDecayReaperService (EPIC-212 Phase-3 Task 4).
 *
 * The contract under test:
 *   1. With `memory_decay_drift_invalidation_enabled=true`, a
 *      `drift_detected_at`-stamped row decays even INSIDE its grace
 *      window, and its effective `daysElapsed` is multiplied by
 *      `memory_decay_drift_penalty_multiplier` so it decays faster.
 *   2. The reaper forwards `treatDriftedAsEligible` to the repository
 *      candidate query (driven by the same flag).
 *   3. With the flag OFF (default), a drifted in-grace row behaves
 *      EXACTLY as today — it is skipped (in-grace) and the repository is
 *      queried without the drift-eligibility override (regression).
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
  MEMORY_DECAY_DRIFT_INVALIDATION_ENABLED_SETTING,
  MEMORY_DECAY_DRIFT_PENALTY_MULTIPLIER_SETTING,
} from '../settings/memory-decay-drift.settings.constants';

const NOW = new Date('2026-06-26T12:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  driftEnabled: boolean,
  multiplier = 3,
): void {
  settings.get.mockImplementation(((key: string, defaultValue: unknown) => {
    if (key === MEMORY_DECAY_SETTING_KEYS.enabled) {
      return Promise.resolve(true);
    }
    if (key === MEMORY_DECAY_DRIFT_INVALIDATION_ENABLED_SETTING) {
      return Promise.resolve(driftEnabled);
    }
    if (key === MEMORY_DECAY_DRIFT_PENALTY_MULTIPLIER_SETTING) {
      return Promise.resolve(multiplier);
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
 * A drifted row touched 10 days ago — comfortably INSIDE the default
 * 30-day grace window, so the legacy classification skips it.
 */
function driftedInGraceRow(): MemorySegment {
  return buildSegment({
    id: 'drifted-in-grace',
    source: 'general',
    last_accessed_at: new Date(NOW.getTime() - 10 * MS_PER_DAY),
    drift_detected_at: new Date(NOW.getTime() - 1 * MS_PER_DAY),
    metadata_json: { confidence: 0.5 },
  });
}

describe('MemoryDecayReaperService — drift invalidation (Phase-3 Task 4)', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = buildMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('decays a drifted in-grace row faster (×multiplier) when the flag is on', async () => {
    mocks.repo.findDecayCandidates.mockResolvedValue([driftedInGraceRow()]);
    configureSettings(mocks.settings, true, 3);
    const moduleRef = await buildModule(mocks);
    const reaper = moduleRef.get(MemoryDecayReaperService);

    const summary = await reaper.runDecayPass({ now: NOW });

    // Grace bypassed: the row decays even though it was touched inside
    // the 30-day grace window. daysElapsed = daysSinceTouch (10) × 3 = 30,
    // so confidence 0.5 - 0.01 × 30 = 0.20 (at the floor → decayed in place).
    expect(summary).toEqual({
      evaluated: 1,
      decayed: 1,
      archived: 0,
      skipped: false,
    });
    expect(mocks.repo.save).toHaveBeenCalledTimes(1);
    const persisted = mocks.repo.save.mock.calls[0]?.[0] as MemorySegment;
    expect(persisted.metadata_json?.['confidence']).toBe(0.2);

    // The reaper forwards the drift-eligibility override to the query.
    const callArgs = mocks.repo.findDecayCandidates.mock.calls[0]?.[0] as {
      treatDriftedAsEligible?: boolean;
    };
    expect(callArgs.treatDriftedAsEligible).toBe(true);
  });

  it('archives a drifted in-grace row once accelerated decay falls below the floor', async () => {
    mocks.repo.findDecayCandidates.mockResolvedValue([
      buildSegment({
        id: 'drifted-archivable',
        source: 'general',
        last_accessed_at: new Date(NOW.getTime() - 20 * MS_PER_DAY),
        drift_detected_at: new Date(NOW.getTime() - 1 * MS_PER_DAY),
        metadata_json: { confidence: 0.5 },
      }),
    ]);
    configureSettings(mocks.settings, true, 3);
    const moduleRef = await buildModule(mocks);
    const reaper = moduleRef.get(MemoryDecayReaperService);

    const summary = await reaper.runDecayPass({ now: NOW });

    // daysElapsed = 20 × 3 = 60, 0.5 - 0.01 × 60 = -0.1 → clamps to 0 < 0.2
    // floor → archived.
    expect(summary).toEqual({
      evaluated: 1,
      decayed: 0,
      archived: 1,
      skipped: false,
    });
    expect(mocks.repo.update).toHaveBeenCalledWith('drifted-archivable', {
      archived_at: NOW,
    });
  });

  it('leaves a drifted in-grace row UNTOUCHED when the flag is off (regression)', async () => {
    mocks.repo.findDecayCandidates.mockResolvedValue([driftedInGraceRow()]);
    configureSettings(mocks.settings, false);
    const moduleRef = await buildModule(mocks);
    const reaper = moduleRef.get(MemoryDecayReaperService);

    const summary = await reaper.runDecayPass({ now: NOW });

    // Flag off → drifted rows behave exactly as today: in-grace → skipped.
    expect(summary).toEqual({
      evaluated: 0,
      decayed: 0,
      archived: 0,
      skipped: false,
    });
    expect(mocks.repo.save).not.toHaveBeenCalled();
    expect(mocks.repo.update).not.toHaveBeenCalled();

    // The repository query is NOT given the drift-eligibility override.
    const callArgs = mocks.repo.findDecayCandidates.mock.calls[0]?.[0] as {
      treatDriftedAsEligible?: boolean;
    };
    expect(callArgs.treatDriftedAsEligible).toBe(false);
  });

  it('does not accelerate a non-drifted row even when the flag is on', async () => {
    mocks.repo.findDecayCandidates.mockResolvedValue([
      buildSegment({
        id: 'non-drifted-in-grace',
        source: 'general',
        last_accessed_at: new Date(NOW.getTime() - 10 * MS_PER_DAY),
        drift_detected_at: null,
        metadata_json: { confidence: 0.5 },
      }),
    ]);
    configureSettings(mocks.settings, true, 3);
    const moduleRef = await buildModule(mocks);
    const reaper = moduleRef.get(MemoryDecayReaperService);

    const summary = await reaper.runDecayPass({ now: NOW });

    // A row with no drift stamp is still subject to the grace window even
    // with the flag on — in-grace → skipped.
    expect(summary).toEqual({
      evaluated: 0,
      decayed: 0,
      archived: 0,
      skipped: false,
    });
    expect(mocks.repo.save).not.toHaveBeenCalled();
  });
});
