import { describe, expect, it, vi } from 'vitest';
import { EventLedgerRepository } from './event-ledger.repository';

describe('EventLedgerRepository', () => {
  it('returns the newest completed turn for a workflow run step', async () => {
    const latestTurn = {
      id: 'event-2',
      workflow_run_id: 'run-1',
      step_id: 'subagent-exec-1',
      event_name: 'workflow.turn.completed',
      occurred_at: new Date('2026-04-30T00:02:00.000Z'),
    };
    const queryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(latestTurn),
    };
    const repository = new EventLedgerRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    });

    const result = await (
      repository as EventLedgerRepository & {
        findLatestTurnForStep(params: {
          workflowRunId: string;
          stepId: string;
        }): Promise<unknown>;
      }
    ).findLatestTurnForStep({
      workflowRunId: 'run-1',
      stepId: 'subagent-exec-1',
    });

    expect(result).toBe(latestTurn);
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'event.workflow_run_id = :workflowRunId',
      { workflowRunId: 'run-1' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'event.step_id = :stepId',
      { stepId: 'subagent-exec-1' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'event.event_name = :eventName',
      { eventName: 'workflow.turn.completed' },
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      'event.occurred_at',
      'DESC',
    );
    expect(queryBuilder.take).toHaveBeenCalledWith(1);
  });

  describe('findLatestMemorySettingChangedByPayloadSource', () => {
    it("returns the latest row matching the payload->>'source' filter", async () => {
      const latestMatch = {
        id: 'event-9',
        event_name: 'memory.setting.changed.v1',
        occurred_at: new Date('2026-04-30T00:05:00.000Z'),
        payload: {
          key: 'memoryDistillationThreshold',
          previousValue: 0.7,
          previousSource: 'default',
          newValue: 0.45,
          newSource: 'global-system-setting',
          source: 'distillation-threshold.service.resolve',
        },
      };
      const queryBuilder = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(latestMatch),
      };
      const repository = new EventLedgerRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      });

      const result = await (
        repository as EventLedgerRepository & {
          findLatestMemorySettingChangedByPayloadSource(params: {
            source: string;
          }): Promise<unknown>;
        }
      ).findLatestMemorySettingChangedByPayloadSource({
        source: 'distillation-threshold.service.resolve',
      });

      expect(result).toBe(latestMatch);
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'event.event_name = :eventName',
        { eventName: 'memory.setting.changed.v1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        "event.payload->>'source' = :source",
        { source: 'distillation-threshold.service.resolve' },
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'event.occurred_at',
        'DESC',
      );
      expect(queryBuilder.take).toHaveBeenCalledWith(1);
    });

    it('returns null when no row matches the source filter', async () => {
      const queryBuilder = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      };
      const repository = new EventLedgerRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      });

      const result = await (
        repository as EventLedgerRepository & {
          findLatestMemorySettingChangedByPayloadSource(params: {
            source: string;
          }): Promise<unknown>;
        }
      ).findLatestMemorySettingChangedByPayloadSource({
        source: 'never-seen.source',
      });

      expect(result).toBeNull();
      // Even with no matches the binding still constrains the row set
      // by the requested source so other producers' rows are excluded.
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        "event.payload->>'source' = :source",
        { source: 'never-seen.source' },
      );
    });

    it('binds the payload source filter with the requested source only', async () => {
      const queryBuilder = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      };
      const repository = new EventLedgerRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      });

      await (
        repository as EventLedgerRepository & {
          findLatestMemorySettingChangedByPayloadSource(params: {
            source: string;
          }): Promise<unknown>;
        }
      ).findLatestMemorySettingChangedByPayloadSource({
        source: 'system-settings.setAndEmit',
      });

      const sourceBinding = queryBuilder.andWhere.mock.calls.find(
        ([clause]) => clause === "event.payload->>'source' = :source",
      );
      expect(sourceBinding).toBeDefined();
      expect(sourceBinding?.[1]).toEqual({
        source: 'system-settings.setAndEmit',
      });

      // The source filter must be the only `andWhere` filter besides
      // the event_name constraint applied via `where`. No `step_id` or
      // `workflow_run_id` filter is added so the lookup spans every
      // replica / workflow run.
      expect(queryBuilder.andWhere).toHaveBeenCalledTimes(1);
      expect(queryBuilder.where).toHaveBeenCalledTimes(1);
    });

    it('orders by occurred_at DESC and takes one row', async () => {
      const queryBuilder = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      };
      const repository = new EventLedgerRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      });

      await (
        repository as EventLedgerRepository & {
          findLatestMemorySettingChangedByPayloadSource(params: {
            source: string;
          }): Promise<unknown>;
        }
      ).findLatestMemorySettingChangedByPayloadSource({
        source: 'distillation-threshold.service.resolve',
      });

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'event.occurred_at',
        'DESC',
      );
      expect(queryBuilder.take).toHaveBeenCalledWith(1);
    });
  });
});
