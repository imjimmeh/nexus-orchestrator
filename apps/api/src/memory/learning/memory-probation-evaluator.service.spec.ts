import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryProbationEvaluatorService } from './memory-probation-evaluator.service';
import { MemorySegmentCrudRepository } from '../database/repositories/memory-segment.crud.repository';
import { MemorySegmentLearningCandidateRepository } from '../database/repositories/memory-segment.learning-candidate.repository';
import { MemorySegmentFeedbackService } from '../memory-segment-feedback.service';
import { MemoryMetricsService } from '../memory-metrics.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { EventLedgerService } from '../../observability/event-ledger.service';
import {
  MEMORY_PROBATION_AUTO_REVERT_ENABLED_SETTING,
  MEMORY_PROBATION_EVALUATOR_ENABLED_SETTING,
  MEMORY_PROBATION_MIN_SAMPLES_SETTING,
  MEMORY_PROBATION_USEFULNESS_THRESHOLD_SETTING,
} from '../../settings/memory-probation.settings.constants';
import type { MemorySegment } from '../database/entities/memory-segment.entity';

const NOW = new Date('2026-06-26T12:00:00.000Z');
const PAST_PROBATION = '2026-06-25T12:00:00.000Z';

interface SettingOverrides {
  evaluatorEnabled?: unknown;
  autoRevertEnabled?: unknown;
  threshold?: unknown;
  minSamples?: unknown;
}

function createSettingsMock(overrides: SettingOverrides = {}) {
  return {
    get: vi.fn(async (key: string, fallback: unknown) => {
      if (key === MEMORY_PROBATION_EVALUATOR_ENABLED_SETTING) {
        return overrides.evaluatorEnabled ?? true;
      }
      if (key === MEMORY_PROBATION_AUTO_REVERT_ENABLED_SETTING) {
        return overrides.autoRevertEnabled ?? false;
      }
      if (key === MEMORY_PROBATION_USEFULNESS_THRESHOLD_SETTING) {
        return overrides.threshold ?? 0.6;
      }
      if (key === MEMORY_PROBATION_MIN_SAMPLES_SETTING) {
        return overrides.minSamples ?? 3;
      }
      return fallback;
    }),
  };
}

function segment(overrides: Partial<MemorySegment> = {}): MemorySegment {
  return {
    id: 'seg-1',
    access_count: 5,
    superseded_by: null,
    drift_detected_at: null,
    governance_state: 'provisional',
    archived_at: null,
    metadata_json: { probation_until: PAST_PROBATION },
    ...overrides,
  } as MemorySegment;
}

function createRepoMock(segments: MemorySegment[]) {
  return {
    findProvisionalPastProbation: vi.fn().mockResolvedValue(segments),
    update: vi.fn().mockResolvedValue(null),
  };
}

function createLearningCandidateRepoMock(segments: MemorySegment[]) {
  return {
    findProvisionalPastProbation: vi.fn().mockResolvedValue(segments),
  };
}

function createFeedbackMock(
  map: Map<string, { usefulness: number | null; sampleSize: number }>,
) {
  return {
    computeUsefulnessForSegments: vi.fn().mockResolvedValue(map),
  };
}

function build(opts: {
  segments: MemorySegment[];
  usefulness?: Map<string, { usefulness: number | null; sampleSize: number }>;
  settings?: SettingOverrides;
  feedback?: boolean;
}) {
  const repo = createRepoMock(opts.segments);
  const settings = createSettingsMock(opts.settings);
  const metrics = { recordProbationOutcome: vi.fn() };
  const eventLedger = { emitBestEffort: vi.fn().mockResolvedValue(undefined) };
  const feedback =
    opts.feedback === false
      ? undefined
      : createFeedbackMock(opts.usefulness ?? new Map());
  const service = new MemoryProbationEvaluatorService(
    createLearningCandidateRepoMock(
      opts.segments,
    ) as unknown as MemorySegmentLearningCandidateRepository,
    repo as unknown as MemorySegmentCrudRepository,
    settings as unknown as SystemSettingsService,
    feedback as unknown as MemorySegmentFeedbackService | undefined,
    metrics as unknown as MemoryMetricsService,
    eventLedger as unknown as EventLedgerService,
  );
  return { service, repo, settings, metrics, eventLedger, feedback };
}

describe('MemoryProbationEvaluatorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('evaluator disabled', () => {
    it('is a no-op with NO DB query when the evaluator flag is off', async () => {
      const { service, repo, metrics } = build({
        segments: [segment()],
        settings: { evaluatorEnabled: false },
      });

      const counts = await service.runProbationPass(NOW);

      expect(repo.findProvisionalPastProbation).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(metrics.recordProbationOutcome).not.toHaveBeenCalled();
      expect(counts).toEqual({ confirmed: 0, reverted: 0, held: 0 });
    });
  });

  describe('confirm', () => {
    it('confirms a useful provisional segment past probation', async () => {
      const usefulness = new Map([
        ['seg-1', { usefulness: 0.9, sampleSize: 5 }],
      ]);
      const { service, repo, metrics } = build({
        segments: [segment()],
        usefulness,
      });

      const counts = await service.runProbationPass(NOW);

      expect(repo.update).toHaveBeenCalledWith('seg-1', {
        governance_state: 'confirmed',
      });
      expect(counts).toEqual({ confirmed: 1, reverted: 0, held: 0 });
      expect(metrics.recordProbationOutcome).toHaveBeenCalledWith({
        confirmed: 1,
        reverted: 0,
        held: 0,
      });
    });
  });

  describe('revert (auto-revert gating)', () => {
    it('archives a low-usefulness segment ONLY when auto-revert is on', async () => {
      const usefulness = new Map([
        ['seg-1', { usefulness: 0.2, sampleSize: 5 }],
      ]);
      const { service, repo, eventLedger } = build({
        segments: [segment()],
        usefulness,
        settings: { autoRevertEnabled: true },
      });

      const counts = await service.runProbationPass(NOW);

      expect(repo.update).toHaveBeenCalledWith('seg-1', { archived_at: NOW });
      expect(counts).toEqual({ confirmed: 0, reverted: 1, held: 0 });
      expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
    });

    it('runs in SHADOW mode (event only, no archive) when auto-revert is off', async () => {
      const usefulness = new Map([
        ['seg-1', { usefulness: 0.2, sampleSize: 5 }],
      ]);
      const { service, repo, eventLedger } = build({
        segments: [segment()],
        usefulness,
        settings: { autoRevertEnabled: false },
      });

      const counts = await service.runProbationPass(NOW);

      expect(repo.update).not.toHaveBeenCalled();
      expect(counts).toEqual({ confirmed: 0, reverted: 0, held: 1 });
      expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(1);
      const payload = eventLedger.emitBestEffort.mock.calls[0][0];
      expect(payload.eventName).toBe('memory.probation.shadow.v1');
      expect(payload.payload.would_revert_segment_ids).toEqual(['seg-1']);
    });

    it('reverts a contradicted (superseded_by) segment when auto-revert is on', async () => {
      const { service, repo } = build({
        segments: [segment({ superseded_by: 'newer-seg' })],
        settings: { autoRevertEnabled: true },
      });

      const counts = await service.runProbationPass(NOW);

      expect(repo.update).toHaveBeenCalledWith('seg-1', { archived_at: NOW });
      expect(counts.reverted).toBe(1);
    });

    it('reverts a drifted (drift_detected_at) segment when auto-revert is on', async () => {
      const { service, repo } = build({
        segments: [
          segment({ drift_detected_at: new Date('2026-06-20T00:00:00Z') }),
        ],
        settings: { autoRevertEnabled: true },
      });

      const counts = await service.runProbationPass(NOW);

      expect(repo.update).toHaveBeenCalledWith('seg-1', { archived_at: NOW });
      expect(counts.reverted).toBe(1);
    });
  });

  describe('hold', () => {
    it('holds an accessed segment with insufficient votes', async () => {
      const usefulness = new Map([
        ['seg-1', { usefulness: 0.2, sampleSize: 1 }],
      ]);
      const { service, repo } = build({
        segments: [segment({ access_count: 4 })],
        usefulness,
      });

      const counts = await service.runProbationPass(NOW);

      expect(repo.update).not.toHaveBeenCalled();
      expect(counts).toEqual({ confirmed: 0, reverted: 0, held: 1 });
    });
  });

  describe('empty candidate set', () => {
    it('records a zero outcome and makes no update calls', async () => {
      const { service, repo, metrics } = build({ segments: [] });

      const counts = await service.runProbationPass(NOW);

      expect(repo.update).not.toHaveBeenCalled();
      expect(counts).toEqual({ confirmed: 0, reverted: 0, held: 0 });
      expect(metrics.recordProbationOutcome).toHaveBeenCalledWith({
        confirmed: 0,
        reverted: 0,
        held: 0,
      });
    });
  });

  describe('fail-soft', () => {
    it('treats a missing feedback service as no-votes (holds an accessed row)', async () => {
      const { service, repo } = build({
        segments: [segment({ access_count: 4 })],
        feedback: false,
      });

      const counts = await service.runProbationPass(NOW);

      expect(repo.update).not.toHaveBeenCalled();
      expect(counts.held).toBe(1);
    });
  });
});

describe('workflow-scoped segments (Epic C regression pin)', () => {
  it('confirms a workflow-scoped provisional segment identically to project scope', async () => {
    const workflowSegment = segment({
      id: 'seg-wf',
      entity_type: 'workflow',
      entity_id: 'implementation-workflow',
    });
    const usefulness = new Map([
      ['seg-wf', { usefulness: 0.9, sampleSize: 5 }],
    ]);
    const { service, repo } = build({
      segments: [workflowSegment],
      usefulness,
    });

    const counts = await service.runProbationPass(NOW);

    expect(repo.update).toHaveBeenCalledWith('seg-wf', {
      governance_state: 'confirmed',
    });
    expect(counts).toEqual({ confirmed: 1, reverted: 0, held: 0 });
  });
});
