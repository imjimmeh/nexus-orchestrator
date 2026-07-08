import { describe, expect, it, vi } from 'vitest';
import {
  ConcurrencyPolicyService,
  ConcurrencyCheckResult,
} from './concurrency-policy.service';

describe('ConcurrencyPolicyService', () => {
  const createService = () => {
    const runRepo = {
      countActiveByScope: vi.fn().mockResolvedValue(0),
      findOldestRunningByScope: vi.fn().mockResolvedValue(null),
    };

    const service = new ConcurrencyPolicyService(runRepo as never);

    return { service, runRepo };
  };

  describe('resolveConcurrencyScope', () => {
    it('returns "global" when scope is omitted', () => {
      const { service } = createService();
      const result = service.resolveConcurrencyScope(
        { max_runs: 1 },
        { scope_id: 'p1' },
      );
      expect(result).toBe('global');
    });

    it('returns "global" when scope is explicitly "global"', () => {
      const { service } = createService();
      const result = service.resolveConcurrencyScope(
        { max_runs: 1, scope: 'global' },
        { scope_id: 'p1' },
      );
      expect(result).toBe('global');
    });

    it('resolves a simple trigger path', () => {
      const { service } = createService();
      const result = service.resolveConcurrencyScope(
        { max_runs: 1, scope: 'trigger.scope_id' },
        { scope_id: 'abc-123' },
      );
      expect(result).toBe('abc-123');
    });

    it('resolves a nested trigger path', () => {
      const { service } = createService();
      const result = service.resolveConcurrencyScope(
        { max_runs: 1, scope: 'trigger.context.id' },
        { context: { id: 'wi-456' } },
      );
      expect(result).toBe('wi-456');
    });

    it('resolves compound scope with + separator', () => {
      const { service } = createService();
      const result = service.resolveConcurrencyScope(
        { max_runs: 1, scope: 'trigger.scope_id+trigger.type' },
        { scope_id: 'p1', type: 'dispatch' },
      );
      expect(result).toBe('p1:dispatch');
    });

    it('uses _null_ sentinel for missing path segments', () => {
      const { service } = createService();
      const result = service.resolveConcurrencyScope(
        { max_runs: 1, scope: 'trigger.missing' },
        { scope_id: 'p1' },
      );
      expect(result).toBe('_null_');
    });

    it('handles compound scope with one missing segment', () => {
      const { service } = createService();
      const result = service.resolveConcurrencyScope(
        { max_runs: 1, scope: 'trigger.scope_id+trigger.missing' },
        { scope_id: 'p1' },
      );
      expect(result).toBe('p1:_null_');
    });
  });

  describe('checkAndApply', () => {
    it('returns proceed when no concurrency policy is defined', async () => {
      const { service } = createService();
      const result = await service.checkAndApply(undefined, 'wf-1', {});
      expect(result).toEqual({ action: 'proceed' });
    });

    it('returns proceed when active count is under max_runs', async () => {
      const { service, runRepo } = createService();
      runRepo.countActiveByScope.mockResolvedValue(0);

      const result = await service.checkAndApply(
        { max_runs: 2, on_conflict: 'skip' },
        'wf-1',
        { scope_id: 'p1' },
      );
      expect(result).toEqual({ action: 'proceed', concurrencyScope: 'global' });
    });

    it('returns skip when at limit with skip policy', async () => {
      const { service, runRepo } = createService();
      runRepo.countActiveByScope.mockResolvedValue(1);

      const result = await service.checkAndApply(
        { max_runs: 1, on_conflict: 'skip' },
        'wf-1',
        { scope_id: 'p1' },
      );
      expect(result).toEqual({ action: 'skip' });
    });

    it('defaults to skip policy when on_conflict is omitted', async () => {
      const { service, runRepo } = createService();
      runRepo.countActiveByScope.mockResolvedValue(1);

      const result = await service.checkAndApply({ max_runs: 1 }, 'wf-1', {
        scope_id: 'p1',
      });
      expect(result).toEqual({ action: 'skip' });
    });

    it('returns queue when at limit with queue policy', async () => {
      const { service, runRepo } = createService();
      runRepo.countActiveByScope.mockResolvedValue(1);

      const result = await service.checkAndApply(
        { max_runs: 1, on_conflict: 'queue' },
        'wf-1',
        { scope_id: 'p1' },
      );
      expect(result).toEqual({ action: 'queue', concurrencyScope: 'global' });
    });

    it('returns cancel with runId when at limit with cancel_running policy', async () => {
      const { service, runRepo } = createService();
      runRepo.countActiveByScope.mockResolvedValue(1);
      runRepo.findOldestRunningByScope.mockResolvedValue({
        id: 'run-oldest',
      });

      const result = await service.checkAndApply(
        { max_runs: 1, on_conflict: 'cancel_running' },
        'wf-1',
        { scope_id: 'p1' },
      );
      expect(result).toEqual({
        action: 'cancel',
        cancelRunId: 'run-oldest',
        concurrencyScope: 'global',
      });
    });

    it('returns skip when cancel_running but no running run found', async () => {
      const { service, runRepo } = createService();
      runRepo.countActiveByScope.mockResolvedValue(1);
      runRepo.findOldestRunningByScope.mockResolvedValue(null);

      const result = await service.checkAndApply(
        { max_runs: 1, on_conflict: 'cancel_running' },
        'wf-1',
        { scope_id: 'p1' },
      );
      expect(result).toEqual({ action: 'skip' });
    });

    it('uses project-scoped concurrency correctly', async () => {
      const { service, runRepo } = createService();
      runRepo.countActiveByScope.mockResolvedValue(0);

      await service.checkAndApply(
        { max_runs: 1, scope: 'trigger.scope_id', on_conflict: 'skip' },
        'wf-1',
        { scope_id: 'proj-abc' },
      );

      expect(runRepo.countActiveByScope).toHaveBeenCalledWith(
        'wf-1',
        'proj-abc',
      );
    });
  });
});
