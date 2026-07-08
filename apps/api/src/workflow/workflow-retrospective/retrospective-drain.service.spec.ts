/**
 * Unit tests for `RetrospectiveDrainService` (EPIC-212 Phase-2 Task 3).
 *
 * The service is the cost governor: budget-capped windowed drain + bounded
 * bypass path, both fail-soft, both depending on the analysis PORT abstraction
 * (Task 6 — stubbed / absent here). Collaborators are typed mocks; no NestJS
 * module, no real DB / BullMQ.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RetrospectiveDrainService } from './retrospective-drain.service';
import type { RetrospectiveQueueRepository } from './retrospective-queue.repository';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { RetrospectiveQueue } from './database/entities/retrospective-queue.entity';
import type {
  RetrospectiveAnalysisOutcome,
  RetrospectiveAnalysisPort,
} from './retrospective-analysis.port';

// ── Mocks ────────────────────────────────────────────────────────────────────

interface MockRepository {
  claimTopN: ReturnType<typeof vi.fn>;
  findByRunId: ReturnType<typeof vi.fn>;
  findByChatSessionId: ReturnType<typeof vi.fn>;
  markStatus: ReturnType<typeof vi.fn>;
}

function createMockRepository(
  overrides: Partial<MockRepository> = {},
): MockRepository {
  return {
    claimTopN: vi.fn().mockResolvedValue([]),
    findByRunId: vi.fn().mockResolvedValue(null),
    findByChatSessionId: vi.fn().mockResolvedValue(null),
    markStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

interface MockSettings {
  get: ReturnType<typeof vi.fn>;
}

/**
 * Returns the supplied fallback for every unknown key → compiled defaults
 * apply. The `retrospective_enabled` master kill-switch defaults to `true` here
 * so the drain-behaviour tests exercise the enabled path; a test can override
 * it to `false` to assert the no-op.
 */
function createMockSettings(
  overrides: Record<string, number | boolean> = {},
): MockSettings {
  const merged: Record<string, number | boolean> = {
    retrospective_enabled: true,
    ...overrides,
  };
  return {
    get: vi.fn(async (key: string, fallback: unknown) =>
      key in merged ? merged[key] : fallback,
    ),
  };
}

interface MockPort {
  analyze: ReturnType<typeof vi.fn>;
}

function createMockPort(
  outcome: RetrospectiveAnalysisOutcome = { status: 'analyzed' },
): MockPort {
  return { analyze: vi.fn().mockResolvedValue(outcome) };
}

function makeRow(
  overrides: Partial<RetrospectiveQueue> = {},
): RetrospectiveQueue {
  const row: RetrospectiveQueue = {
    id: `row-${Math.random().toString(36).slice(2)}`,
    workflow_run_id: `run-${Math.random().toString(36).slice(2)}`,
    scope_id: 'scope-1',
    terminal_status: 'failed',
    interest_score: 0.8,
    priority: 'high',
    status: 'queued',
    signals_json: {},
    enqueued_at: new Date(),
    drained_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  return row;
}

function build(
  repository: MockRepository,
  settings: MockSettings,
  port?: MockPort,
): RetrospectiveDrainService {
  return new RetrospectiveDrainService(
    repository as unknown as RetrospectiveQueueRepository,
    settings as unknown as SystemSettingsService,
    port as unknown as RetrospectiveAnalysisPort | undefined,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RetrospectiveDrainService', () => {
  describe('drainWindow — budget cap', () => {
    let repository: MockRepository;
    let settings: MockSettings;
    let port: MockPort;

    beforeEach(() => {
      // claimTopN already enforces the limit; the repository returns exactly
      // `budget` rows. The service must claim with the configured budget and
      // analyze each returned row once.
      const claimed = Array.from({ length: 5 }, () =>
        makeRow({ interest_score: 0.8 }),
      );
      repository = createMockRepository({
        claimTopN: vi.fn().mockResolvedValue(claimed),
      });
      settings = createMockSettings(); // defaults: budget=5, bypass=3, floor=0.4
      port = createMockPort();
    });

    it('claims exactly budgetPerWindow queued rows and analyzes each', async () => {
      const service = build(repository, settings, port);

      const summary = await service.drainWindow();

      expect(repository.claimTopN).toHaveBeenCalledWith(5, ['queued']);
      expect(port.analyze).toHaveBeenCalledTimes(5);
      expect(summary.claimed).toBe(5);
      expect(summary.analyzed).toBe(5);
      expect(summary.skipped).toBe(0);
      expect(summary.failed).toBe(0);
    });

    it('marks each analyzed row analyzed with drained_at set', async () => {
      const service = build(repository, settings, port);

      await service.drainWindow();

      const analyzedCalls = repository.markStatus.mock.calls.filter(
        (call) => call[1] === 'analyzed',
      );
      expect(analyzedCalls).toHaveLength(5);
      for (const call of analyzedCalls) {
        expect(call[2].drained_at).toBeInstanceOf(Date);
      }
    });
  });

  describe('drainWindow — master kill-switch', () => {
    it('no-ops with an empty summary when retrospective_enabled is false', async () => {
      const repository = createMockRepository({
        claimTopN: vi
          .fn()
          .mockResolvedValue([makeRow({ interest_score: 0.9 })]),
      });
      const settings = createMockSettings({ retrospective_enabled: false });
      const port = createMockPort();
      const service = build(repository, settings, port);

      const summary = await service.drainWindow();

      expect(repository.claimTopN).not.toHaveBeenCalled();
      expect(port.analyze).not.toHaveBeenCalled();
      expect(summary).toEqual({
        claimed: 0,
        analyzed: 0,
        skipped: 0,
        failed: 0,
        deferred: 0,
      });
    });
  });

  describe('drainWindow — interest floor', () => {
    it('marks below-floor rows skipped WITHOUT calling the analyzer', async () => {
      const belowFloor = makeRow({ interest_score: 0.1 });
      const aboveFloor = makeRow({ interest_score: 0.9 });
      const repository = createMockRepository({
        claimTopN: vi.fn().mockResolvedValue([belowFloor, aboveFloor]),
      });
      const settings = createMockSettings(); // floor 0.4
      const port = createMockPort();
      const service = build(repository, settings, port);

      const summary = await service.drainWindow();

      // The analyzer is only called for the above-floor row.
      expect(port.analyze).toHaveBeenCalledTimes(1);
      expect(port.analyze).toHaveBeenCalledWith(aboveFloor);
      expect(summary.skipped).toBe(1);
      expect(summary.analyzed).toBe(1);
      const skipCall = repository.markStatus.mock.calls.find(
        (call) => call[0] === belowFloor.id,
      );
      expect(skipCall?.[1]).toBe('skipped');
      expect(skipCall?.[2].signals_json.drain_skip_reason).toBe(
        'below_interest_floor',
      );
    });
  });

  describe('drainWindow — per-row failure isolation', () => {
    it('marks a throwing row failed and still processes the rest', async () => {
      const rowA = makeRow({ interest_score: 0.8 });
      const rowB = makeRow({ interest_score: 0.8 });
      const repository = createMockRepository({
        claimTopN: vi.fn().mockResolvedValue([rowA, rowB]),
      });
      const settings = createMockSettings();
      const port: MockPort = {
        analyze: vi
          .fn()
          .mockRejectedValueOnce(new Error('analyst boom'))
          .mockResolvedValueOnce({ status: 'analyzed' }),
      };
      const service = build(repository, settings, port);

      const summary = await service.drainWindow();

      expect(port.analyze).toHaveBeenCalledTimes(2);
      expect(summary.failed).toBe(1);
      expect(summary.analyzed).toBe(1);
      const failCall = repository.markStatus.mock.calls.find(
        (call) => call[0] === rowA.id,
      );
      expect(failCall?.[1]).toBe('failed');
    });
  });

  describe('drainWindow — analysis port ABSENT (Task 6 not wired)', () => {
    it('does not analyze and resets claimed rows to queued (rows not lost)', async () => {
      const row = makeRow({ interest_score: 0.9 });
      const repository = createMockRepository({
        claimTopN: vi.fn().mockResolvedValue([row]),
      });
      const settings = createMockSettings();
      const service = build(repository, settings, undefined); // no port

      const summary = await service.drainWindow();

      expect(summary.deferred).toBe(1);
      expect(summary.analyzed).toBe(0);
      const resetCall = repository.markStatus.mock.calls.find(
        (call) => call[0] === row.id,
      );
      expect(resetCall?.[1]).toBe('queued');
      // A deferred row carries no drained_at — it is still pending, not done.
      expect(resetCall?.[2].drained_at).toBeUndefined();
    });
  });

  describe('analyzeImmediately — bypass path', () => {
    it('analyzes immediately and decrements the bypass budget until exhausted', async () => {
      const settings = createMockSettings({ retrospective_bypass_budget: 2 });
      const rows = [
        makeRow({ interest_score: 0.95 }),
        makeRow({ interest_score: 0.95 }),
        makeRow({ interest_score: 0.95 }),
      ];
      const repository = createMockRepository({
        findByRunId: vi
          .fn()
          .mockResolvedValueOnce(rows[0])
          .mockResolvedValueOnce(rows[1])
          .mockResolvedValueOnce(rows[2]),
      });
      const port = createMockPort();
      const service = build(repository, settings, port);

      const first = await service.analyzeImmediately(rows[0].workflow_run_id);
      const second = await service.analyzeImmediately(rows[1].workflow_run_id);
      const third = await service.analyzeImmediately(rows[2].workflow_run_id);

      expect(first.status).toBe('analyzed');
      expect(second.status).toBe('analyzed');
      // Budget (2) exhausted → third request skipped, analyzer NOT called again.
      expect(third.status).toBe('skipped');
      expect(third.reason).toBe('bypass_budget_exhausted');
      expect(port.analyze).toHaveBeenCalledTimes(2);
    });

    it('skips a below-floor run without analyzing', async () => {
      const row = makeRow({ interest_score: 0.1 });
      const repository = createMockRepository({
        findByRunId: vi.fn().mockResolvedValue(row),
      });
      const port = createMockPort();
      const service = build(repository, createMockSettings(), port);

      const outcome = await service.analyzeImmediately(row.workflow_run_id);

      expect(outcome.status).toBe('skipped');
      expect(outcome.reason).toBe('below_interest_floor');
      expect(port.analyze).not.toHaveBeenCalled();
    });

    it('skips when the analysis port is absent (row left claimable)', async () => {
      const row = makeRow({ interest_score: 0.95 });
      const repository = createMockRepository({
        findByRunId: vi.fn().mockResolvedValue(row),
      });
      const service = build(repository, createMockSettings(), undefined);

      const outcome = await service.analyzeImmediately(row.workflow_run_id);

      expect(outcome.status).toBe('skipped');
      expect(outcome.reason).toBe('analyzer_unavailable');
      // The row was never flipped away from `queued`.
      const drainingCall = repository.markStatus.mock.calls.find(
        (call) => call[1] === 'draining',
      );
      expect(drainingCall).toBeUndefined();
    });

    it('resets the bypass budget at the start of each window', async () => {
      const settings = createMockSettings({ retrospective_bypass_budget: 1 });
      const row = makeRow({ interest_score: 0.95 });
      const repository = createMockRepository({
        findByRunId: vi.fn().mockResolvedValue(row),
        claimTopN: vi.fn().mockResolvedValue([]),
      });
      const port = createMockPort();
      const service = build(repository, settings, port);

      await service.analyzeImmediately(row.workflow_run_id); // spends the 1 slot
      const exhausted = await service.analyzeImmediately(row.workflow_run_id);
      expect(exhausted.reason).toBe('bypass_budget_exhausted');

      await service.drainWindow(); // resets the per-window bypass counter

      const afterReset = await service.analyzeImmediately(row.workflow_run_id);
      expect(afterReset.status).toBe('analyzed');
    });
  });
});
