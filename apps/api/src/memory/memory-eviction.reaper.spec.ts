import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { MemoryEvictionReaperService } from './memory-eviction.reaper';
import { MemorySegmentEvictionRepository } from './database/repositories/memory-segment.eviction.repository';
import { MemorySegmentCrudRepository } from './database/repositories/memory-segment.crud.repository';
import type { MemorySegment } from './database/entities/memory-segment.entity';
import { EventLedgerService } from '../observability/event-ledger.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import {
  MEMORY_SEGMENT_EVICTION_MAX_IDLE_DAYS,
  MEMORY_SEGMENT_EVICTION_MIN_ACCESS_COUNT,
  MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES,
} from '../settings/learning-settings.constants';
import { MEMORY_SEGMENT_EVICTED_EVENT } from './memory-eviction.constants';
import {
  DEFAULT_MAX_IDLE_DAYS,
  DEFAULT_MIN_ACCESS_COUNT,
  DEFAULT_PROTECTED_SOURCES,
} from './memory-eviction.constants';

interface MockMemorySegmentEvictionRepository {
  findEvictionCandidates: ReturnType<typeof vi.fn>;
}

interface MockMemorySegmentCrudRepository {
  remove: ReturnType<typeof vi.fn>;
}

interface MockMemorySegmentRepository
  extends
    MockMemorySegmentEvictionRepository,
    MockMemorySegmentCrudRepository {}

interface MockEventLedger {
  emitBestEffort: ReturnType<typeof vi.fn>;
}

interface MockSystemSettings {
  get: ReturnType<typeof vi.fn>;
}

const NOW = new Date('2026-06-17T12:00:00.000Z');

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
    // Decay-reaper columns (work item 3d7fb798). The eviction
    // reaper operates on the disjoint `archived_at IS NULL` set
    // so archived rows never reach this codepath, and the
    // reaper's `effective_last_touch` (which the eviction
    // reaper does not consume) is composed by the decay reaper
    // from `last_accessed_at` and `last_reinforced_at`. The test
    // fixture seeds both as `null` ("never reinforced") so the
    // reaper's view of each row stays consistent with the
    // production entity shape.
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
  settings: MockSystemSettings,
  values: {
    maxIdleDays?: number;
    minAccessCount?: number;
    protectedSources?: string;
  },
): void {
  settings.get.mockImplementation(((key: string, defaultValue: unknown) => {
    if (key === MEMORY_SEGMENT_EVICTION_MAX_IDLE_DAYS) {
      return Promise.resolve(
        values.maxIdleDays ?? defaultValue ?? DEFAULT_MAX_IDLE_DAYS,
      );
    }
    if (key === MEMORY_SEGMENT_EVICTION_MIN_ACCESS_COUNT) {
      return Promise.resolve(
        values.minAccessCount ?? defaultValue ?? DEFAULT_MIN_ACCESS_COUNT,
      );
    }
    if (key === MEMORY_SEGMENT_EVICTION_PROTECTED_SOURCES) {
      return Promise.resolve(
        values.protectedSources ??
          defaultValue ??
          DEFAULT_PROTECTED_SOURCES.join(','),
      );
    }
    return Promise.resolve(defaultValue);
  }) as never);
}

async function buildModule(
  repo: MockMemorySegmentRepository,
  settings: MockSystemSettings,
  ledger: MockEventLedger | null,
): Promise<TestingModule> {
  const providers: Provider[] = [
    MemoryEvictionReaperService,
    { provide: MemorySegmentEvictionRepository, useValue: repo },
    { provide: MemorySegmentCrudRepository, useValue: repo },
    { provide: SystemSettingsService, useValue: settings },
  ];
  if (ledger !== null) {
    providers.push({ provide: EventLedgerService, useValue: ledger });
  }
  return Test.createTestingModule({ providers }).compile();
}

describe('MemoryEvictionReaperService', () => {
  let repo: MockMemorySegmentRepository;
  let settings: MockSystemSettings;
  let ledger: MockEventLedger;

  beforeEach(() => {
    repo = {
      findEvictionCandidates: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    settings = {
      get: vi.fn(),
    };
    ledger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('runOnce', () => {
    it('deletes never-touched segments older than the threshold and emits one event per deleted row', async () => {
      // Case 1 of the work item spec: `last_accessed_at` is null
      // (never touched), `access_count = 0`, `pinned = false`, source
      // not in the protected allowlist. The row is old (created well
      // before the 90-day default cutoff). The reaper should delete
      // it and emit a `memory.segment.evicted.v1` event.
      const staleNeverTouched = buildSegment({
        id: 'seg-stale-never-touched',
        source: 'project.memory',
        last_accessed_at: null,
        access_count: 0,
        pinned: false,
        created_at: new Date('2025-01-01T00:00:00.000Z'),
      });
      repo.findEvictionCandidates.mockResolvedValue([staleNeverTouched]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(repo, settings, ledger);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      const summary = await reaper.runOnce({ now: NOW });

      expect(summary.scanned).toBe(1);
      expect(summary.evicted).toBe(1);
      expect(summary.errors).toBe(0);
      expect(summary.settings).toEqual({
        maxIdleDays: DEFAULT_MAX_IDLE_DAYS,
        minAccessCount: DEFAULT_MIN_ACCESS_COUNT,
        protectedSources: expect.arrayContaining([
          ...DEFAULT_PROTECTED_SOURCES,
        ]),
      });
      expect(repo.remove).toHaveBeenCalledTimes(1);
      expect(repo.remove).toHaveBeenCalledWith('seg-stale-never-touched');
      expect(ledger.emitBestEffort).toHaveBeenCalledTimes(1);
      expect(ledger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'memory',
          eventName: MEMORY_SEGMENT_EVICTED_EVENT,
          outcome: 'success',
          payload: expect.objectContaining({
            segmentId: 'seg-stale-never-touched',
            source: 'project.memory',
            lastAccessedAt: null,
            accessCount: 0,
            evictedAt: expect.any(String),
          }),
        }),
      );
    });

    it('keeps recently-touched segments even when access_count is below the floor', async () => {
      // Case 2: the row's `last_accessed_at` is within the threshold
      // window — it was touched 5 days ago, well under the 90-day
      // default. The repository returns no candidates (the WHERE
      // clause excludes it), the reaper scans zero rows, and the
      // delete + event are never invoked.
      const recentlyTouched = buildSegment({
        id: 'seg-recent',
        source: 'project.memory',
        last_accessed_at: new Date('2026-06-12T12:00:00.000Z'),
        access_count: 0,
        pinned: false,
      });
      repo.findEvictionCandidates.mockResolvedValue([]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(repo, settings, ledger);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      const summary = await reaper.runOnce({ now: NOW });

      expect(summary).toEqual(
        expect.objectContaining({
          scanned: 0,
          evicted: 0,
          errors: 0,
        }),
      );
      expect(repo.remove).not.toHaveBeenCalled();
      expect(ledger.emitBestEffort).not.toHaveBeenCalled();
      // Sanity check: the candidate row is the one that should have
      // been excluded by the repository WHERE clause. We do not
      // re-implement the SQL filter here — the repository is
      // exercised end-to-end in the integration milestone — but the
      // empty-array result confirms the reaper does not delete rows
      // the repository did not return.
      expect(recentlyTouched.last_accessed_at?.toISOString()).toBe(
        '2026-06-12T12:00:00.000Z',
      );
    });

    it('never deletes pinned segments, even when the repository contract is weakened', async () => {
      // Case 3: the repository candidate query already filters
      // `pinned = false` out of the result set, but the reaper must
      // also be defensive in case the repository contract is
      // weakened (e.g. a future repository refactor drops the
      // clause). We exercise the belt-and-suspenders check by
      // handing the reaper a pinned row and verifying it is
      // skipped — no delete, no event.
      const pinnedRow = buildSegment({
        id: 'seg-pinned',
        source: 'project.memory',
        last_accessed_at: null,
        access_count: 0,
        pinned: true,
        created_at: new Date('2025-01-01T00:00:00.000Z'),
      });
      repo.findEvictionCandidates.mockResolvedValue([pinnedRow]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(repo, settings, ledger);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      const summary = await reaper.runOnce({ now: NOW });

      expect(summary.scanned).toBe(1);
      expect(summary.evicted).toBe(0);
      expect(summary.skipped).toBe(1);
      expect(summary.errors).toBe(0);
      expect(repo.remove).not.toHaveBeenCalled();
      expect(ledger.emitBestEffort).not.toHaveBeenCalled();
    });

    it('preserves learning_candidate segments by default', async () => {
      // Case 4: the reaper's hardcoded default protected allowlist
      // is `learning_candidate`. We verify the reaper passes that
      // value down to the repository and the repository's `NOT IN`
      // filter excludes the learning_candidate row. We exercise
      // this by setting up the repository to return only the
      // non-learning_candidate row (the WHERE clause in the repo
      // contract excludes the protected source) and asserting the
      // reaper deletes that one.
      const evictable = buildSegment({
        id: 'seg-evictable',
        source: 'project.memory',
        last_accessed_at: null,
        access_count: 0,
        pinned: false,
        created_at: new Date('2025-01-01T00:00:00.000Z'),
      });
      repo.findEvictionCandidates.mockImplementation(((params: {
        protectedSources: readonly string[];
      }) => {
        // Mirror the repository contract: a row whose source is in
        // the allowlist must NOT appear in the candidate list. The
        // learning_candidate row never reaches the reaper.
        expect(params.protectedSources).toEqual(
          expect.arrayContaining(['learning_candidate']),
        );
        return Promise.resolve([evictable]);
      }) as never);
      configureSettings(settings, {});

      const moduleRef = await buildModule(repo, settings, ledger);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      const summary = await reaper.runOnce({ now: NOW });

      expect(summary.scanned).toBe(1);
      expect(summary.evicted).toBe(1);
      expect(repo.remove).toHaveBeenCalledWith('seg-evictable');
    });

    it('emits memory.segment.evicted.v1 with segment_id and source in the payload', async () => {
      // Case 5: assert the exact event name and the segment id /
      // source fields in the payload. The other payload fields are
      // covered by case 1 — this case pins the wire contract.
      const segment = buildSegment({
        id: 'seg-emit-contract',
        source: 'project.fact',
        last_accessed_at: new Date('2026-01-01T00:00:00.000Z'),
        access_count: 0,
        pinned: false,
      });
      repo.findEvictionCandidates.mockResolvedValue([segment]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(repo, settings, ledger);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      await reaper.runOnce({ now: NOW });

      expect(ledger.emitBestEffort).toHaveBeenCalledTimes(1);
      const call = ledger.emitBestEffort.mock.calls[0]?.[0] as {
        eventName: string;
        payload: { segmentId: string; source: string };
      };
      expect(call.eventName).toBe('memory.segment.evicted.v1');
      expect(MEMORY_SEGMENT_EVICTED_EVENT).toBe('memory.segment.evicted.v1');
      expect(call.payload.segmentId).toBe('seg-emit-contract');
      expect(call.payload.source).toBe('project.fact');
    });

    it('honours a tighter max_idle_days window configured via SystemSettingsService', async () => {
      // Case 6: the operator tightens the threshold from the 90-day
      // default to 30 days. The same stale row that the previous
      // tests treated as a candidate is now either older (still
      // eligible) or not — we verify the new cutoff by passing a
      // segment whose `last_accessed_at` sits in the 30..90 window.
      // The repository's WHERE clause does the math; the reaper's
      // contract is "the cutoff is read fresh on every run".
      //
      // We exercise the reaper-side: a 5-day-old row is a candidate
      // under the 30-day window but NOT under the 90-day default.
      // We stub the repository to return the row only when the
      // reaper asks for the 30-day cutoff.
      const rowTouched40DaysAgo = buildSegment({
        id: 'seg-40d',
        source: 'project.memory',
        last_accessed_at: new Date('2026-05-08T12:00:00.000Z'),
        access_count: 0,
        pinned: false,
      });
      repo.findEvictionCandidates.mockImplementation(((params: {
        idleCutoff: Date;
      }) => {
        // 30 days back from NOW is 2026-05-18. A row touched
        // 2026-05-08 is 40 days old → older than 30 days → eligible
        // only when maxIdleDays <= 30. We emulate the SQL by
        // checking the cutoff.
        const lastAccessed = rowTouched40DaysAgo.last_accessed_at;
        if (
          lastAccessed !== null &&
          lastAccessed.getTime() < params.idleCutoff.getTime()
        ) {
          return Promise.resolve([rowTouched40DaysAgo]);
        }
        return Promise.resolve([]);
      }) as never);
      configureSettings(settings, { maxIdleDays: 30 });

      const moduleRef = await buildModule(repo, settings, ledger);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      const summary = await reaper.runOnce({ now: NOW });

      expect(summary.settings.maxIdleDays).toBe(30);
      expect(summary.evicted).toBe(1);
      expect(repo.remove).toHaveBeenCalledWith('seg-40d');
    });

    it('respects the min_access_count threshold: rows at or above the floor are never evicted', async () => {
      // Optional case 7: `access_count >= min_access_count` is a
      // hard preservation rule. The repository's `WHERE
      // access_count < :minAccessCount` clause does the filtering.
      // The reaper contract is "the floor is read fresh and passed
      // to the repository". We verify by stubbing the repository
      // to mirror the SQL predicate: the row is a candidate only
      // when its `access_count` is strictly below the floor. A row
      // at the floor (access_count === minAccessCount) is preserved.
      const rowAtTheFloor = buildSegment({
        id: 'seg-5-reads',
        source: 'project.memory',
        last_accessed_at: null,
        access_count: 5,
        pinned: false,
        created_at: new Date('2025-01-01T00:00:00.000Z'),
      });
      repo.findEvictionCandidates.mockImplementation(((params: {
        minAccessCount: number;
      }) => {
        if (rowAtTheFloor.access_count < params.minAccessCount) {
          return Promise.resolve([rowAtTheFloor]);
        }
        return Promise.resolve([]);
      }) as never);
      configureSettings(settings, { minAccessCount: 5 });

      const moduleRef = await buildModule(repo, settings, ledger);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      const summary = await reaper.runOnce({ now: NOW });

      expect(summary.settings.minAccessCount).toBe(5);
      expect(summary.evicted).toBe(0);
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('honours a custom protected_sources allowlist set via SystemSettingsService', async () => {
      // Optional case 8: the operator replaces the default
      // `learning_candidate` allowlist with a different value (e.g.
      // `audit_trail`). The reaper passes the new value down to the
      // repository and the row that was previously protected
      // (because it carried the old source value) is now
      // evictable. We verify by feeding the reaper a custom
      // allowlist and asserting the repository received it.
      const evictable = buildSegment({
        id: 'seg-previously-protected',
        source: 'project.memory',
        last_accessed_at: null,
        access_count: 0,
        pinned: false,
        created_at: new Date('2025-01-01T00:00:00.000Z'),
      });
      repo.findEvictionCandidates.mockImplementation(((params: {
        protectedSources: readonly string[];
      }) => {
        expect(params.protectedSources).toEqual(['audit_trail']);
        return Promise.resolve([evictable]);
      }) as never);
      configureSettings(settings, { protectedSources: 'audit_trail' });

      const moduleRef = await buildModule(repo, settings, ledger);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      const summary = await reaper.runOnce({ now: NOW });

      expect(summary.settings.protectedSources).toEqual(['audit_trail']);
      expect(summary.evicted).toBe(1);
      expect(repo.remove).toHaveBeenCalledWith('seg-previously-protected');
    });

    it('falls back to the hardcoded default when the protected_sources setting is empty', async () => {
      // Defensive: the reaper refuses to run with an empty
      // allowlist so a disaster-recovery seed that wipes the
      // protected sources cannot silently delete learning-candidate
      // memory. We verify by setting the setting to an empty
      // string and asserting the reaper falls back to the
      // `learning_candidate` default.
      const evictable = buildSegment({
        id: 'seg-empty-allowlist',
        source: 'project.memory',
        last_accessed_at: null,
        access_count: 0,
        pinned: false,
        created_at: new Date('2025-01-01T00:00:00.000Z'),
      });
      repo.findEvictionCandidates.mockImplementation(((params: {
        protectedSources: readonly string[];
      }) => {
        expect(params.protectedSources).toEqual(
          expect.arrayContaining(['learning_candidate']),
        );
        return Promise.resolve([evictable]);
      }) as never);
      configureSettings(settings, { protectedSources: '' });

      const moduleRef = await buildModule(repo, settings, ledger);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      const summary = await reaper.runOnce({ now: NOW });

      expect(summary.settings.protectedSources).toEqual(
        expect.arrayContaining(['learning_candidate']),
      );
      expect(summary.evicted).toBe(1);
    });

    it('continues past a per-row delete failure and reports it in the summary', async () => {
      // Defensive: a transient DB error on one row should not stop
      // the rest of the run. The reaper logs the error, increments
      // `errors`, and moves on. The remaining rows in the batch are
      // still deleted and the run summary is returned to the
      // caller.
      const failing = buildSegment({
        id: 'seg-fails',
        source: 'project.memory',
        last_accessed_at: null,
        access_count: 0,
        pinned: false,
        created_at: new Date('2025-01-01T00:00:00.000Z'),
      });
      const ok = buildSegment({
        id: 'seg-ok',
        source: 'project.memory',
        last_accessed_at: null,
        access_count: 0,
        pinned: false,
        created_at: new Date('2025-01-01T00:00:00.000Z'),
      });
      repo.findEvictionCandidates.mockResolvedValue([failing, ok]);
      repo.remove.mockImplementation((async (id: string) => {
        if (id === 'seg-fails') {
          throw new Error('connection reset');
        }
      }) as never);
      configureSettings(settings, {});

      const moduleRef = await buildModule(repo, settings, ledger);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      const summary = await reaper.runOnce({ now: NOW });

      expect(summary.scanned).toBe(2);
      expect(summary.evicted).toBe(1);
      expect(summary.errors).toBe(1);
      // The successful row still triggers an event; the failed row
      // does not.
      expect(ledger.emitBestEffort).toHaveBeenCalledTimes(1);
      expect(ledger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ segmentId: 'seg-ok' }),
        }),
      );
    });

    it('returns a zeroed summary and does not delete anything when no rows are candidates', async () => {
      repo.findEvictionCandidates.mockResolvedValue([]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(repo, settings, ledger);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      const summary = await reaper.runOnce({ now: NOW });

      expect(summary).toEqual(
        expect.objectContaining({
          scanned: 0,
          evicted: 0,
          skipped: 0,
          errors: 0,
        }),
      );
      expect(summary.startedAt).toBe(NOW.toISOString());
      expect(summary.finishedAt).not.toBe('');
      expect(repo.remove).not.toHaveBeenCalled();
      expect(ledger.emitBestEffort).not.toHaveBeenCalled();
    });

    it('works without an EventLedger dependency', async () => {
      // The reaper must remain usable when the EventLedger is
      // absent — e.g. a test wiring that does not include the
      // ObservabilityModule. The delete still happens; the event
      // emission is silently skipped.
      const segment = buildSegment({
        id: 'seg-no-ledger',
        source: 'project.memory',
        last_accessed_at: null,
        access_count: 0,
        pinned: false,
        created_at: new Date('2025-01-01T00:00:00.000Z'),
      });
      repo.findEvictionCandidates.mockResolvedValue([segment]);
      configureSettings(settings, {});

      const moduleRef = await buildModule(repo, settings, null);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      const summary = await reaper.runOnce({ now: NOW });

      expect(summary.evicted).toBe(1);
      expect(repo.remove).toHaveBeenCalledWith('seg-no-ledger');
    });

    it('includes onboarding_chat and user_edit in the default protected-sources allowlist passed to the repository', async () => {
      // C1: charter-origin sources must be in the hardcoded
      // DEFAULT_PROTECTED_SOURCES allowlist so the reaper passes them to
      // the repository's NOT IN filter and they are never returned as
      // eviction candidates when the operator has not configured a
      // custom allowlist.
      //
      // We exercise the same pattern as the `learning_candidate` case
      // (Case 4): stub the repository to mirror the SQL contract
      // (charter rows excluded by NOT IN) and assert that:
      //   (a) the reaper passed the charter sources in protectedSources, and
      //   (b) the run summary reflects the charter sources in settings.
      const evictable = buildSegment({
        id: 'seg-evictable-charter',
        source: 'project.memory',
        last_accessed_at: null,
        access_count: 0,
        pinned: false,
        created_at: new Date('2025-01-01T00:00:00.000Z'),
      });
      repo.findEvictionCandidates.mockImplementation(((params: {
        protectedSources: readonly string[];
      }) => {
        // Assert the default allowlist includes the charter sources.
        expect(params.protectedSources).toEqual(
          expect.arrayContaining(['onboarding_chat', 'user_edit']),
        );
        // Mirror the repository's NOT IN contract: charter-source rows
        // are excluded from the candidate set at the SQL level.
        return Promise.resolve([evictable]);
      }) as never);
      configureSettings(settings, {});

      const moduleRef = await buildModule(repo, settings, ledger);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      const summary = await reaper.runOnce({ now: NOW });

      // The non-charter evictable row was deleted.
      expect(summary.evicted).toBe(1);
      expect(repo.remove).toHaveBeenCalledWith('seg-evictable-charter');
      // The summary's settings surface reflects both charter sources in
      // the protected allowlist.
      expect(summary.settings.protectedSources).toEqual(
        expect.arrayContaining(['onboarding_chat', 'user_edit']),
      );
    });

    it('coerces a non-numeric max_idle_days setting to the hardcoded default', async () => {
      // The setting is stored as a string by some operators. A
      // garbage value should not crash the reaper; the coercion
      // helper falls back to the hardcoded default.
      const evictable = buildSegment({
        id: 'seg-coerced',
        source: 'project.memory',
        last_accessed_at: null,
        access_count: 0,
        pinned: false,
        created_at: new Date('2025-01-01T00:00:00.000Z'),
      });
      repo.findEvictionCandidates.mockResolvedValue([evictable]);
      settings.get.mockImplementation(((key: string, defaultValue: unknown) => {
        if (key === MEMORY_SEGMENT_EVICTION_MAX_IDLE_DAYS) {
          return Promise.resolve('not-a-number');
        }
        return Promise.resolve(defaultValue);
      }) as never);

      const moduleRef = await buildModule(repo, settings, ledger);
      const reaper = moduleRef.get(MemoryEvictionReaperService);

      const summary = await reaper.runOnce({ now: NOW });

      expect(summary.settings.maxIdleDays).toBe(DEFAULT_MAX_IDLE_DAYS);
    });
  });
});
