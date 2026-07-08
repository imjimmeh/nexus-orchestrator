import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MemoryMetricsController } from './memory-metrics.controller';
import type { MemoryMetricsService } from './memory-metrics.service';
import type { MemoryMetricsSnapshot } from './memory-metrics.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';

describe('MemoryMetricsController', () => {
  const getSnapshot = vi.fn();

  let controller: MemoryMetricsController;

  beforeEach(() => {
    vi.clearAllMocks();

    controller = new MemoryMetricsController({
      getSnapshot,
    } as unknown as MemoryMetricsService);
  });

  it('returns the in-memory snapshot wrapped in the success envelope', async () => {
    const expected: MemoryMetricsSnapshot = {
      backend: {
        read: {
          total: { postgres: 3, honcho: 1 },
          latency_ms: {
            postgres: { count: 3, sum: 72, p50: 24, p95: 36, p99: 36 },
            honcho: { count: 1, sum: 50, p50: 50, p95: 50, p99: 50 },
          },
        },
        write: {
          total: {
            postgres: { success: 2, failure: 1 },
            honcho: { success: 1, failure: 0 },
          },
        },
        active_segments: {
          total: { postgres: { memory: 42 }, honcho: {} },
        },
        fallback: { 'honcho->postgres:searchMemory': 2 },
      },
      distillation: {
        completed_total: { success: 1, failure: 0, skipped: 0 },
        last: {
          input_segment_count: 100,
          output_segment_count: 60,
          compression_ratio: 0.6,
          tokens_before: 1000,
          tokens_after: 600,
          model: 'claude-3-5-sonnet',
          duration_ms: 1234,
          completed_at: '2026-01-01T00:00:00.000Z',
        },
      },
      learning: {
        promoted_total: 1,
        last_promoted: {
          candidate_id: 'c-1',
          confidence: 0.9,
          scope: 'workflow:global',
          source_decision_id: 'policy:foo:approved',
          promoted_at: '2026-01-01T00:00:00.000Z',
        },
        lesson_injected_total: 0,
        last_lesson_injected: null,
        run_outcome_after_lesson_total: 0,
        last_run_outcome_after_lesson: null,
        // Milestone 3 — convergence block on the per-process
        // snapshot. Empty map is the "no in-window signal"
        // surface documented on
        // `MemoryMetricsService.computeConvergenceSnapshots`.
        convergence: {},
      },
      postmortem: {
        recorded_total: { success: 1, skipped: 0, failed: 0 },
        last_recorded: {
          occurred_at: '2026-01-01T00:00:00.000Z',
          outcome: 'success',
          memory_segment_id: 'memory-1',
        },
      },
      memoryDecayLastRun: null,
      generated_at: '2026-01-01T00:00:00.000Z',
    };

    getSnapshot.mockResolvedValue(expected);

    const result = await controller.getSnapshot();

    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(getSnapshot).toHaveBeenCalledWith();
    expect(result).toEqual({ success: true, data: expected });
  });

  it('uses JwtAuthGuard and PermissionsGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      MemoryMetricsController,
    ) as unknown[];

    expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
  });
});
