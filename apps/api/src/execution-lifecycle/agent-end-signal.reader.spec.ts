import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { AgentEndSignalReader } from './agent-end-signal.reader';
import type { EventLedger } from '../runtime/database/entities/event-ledger.entity';

const AGENT_COMPLETED_DOMAIN = 'workflow';
const AGENT_COMPLETED_EVENT_NAME = 'workflow.agent.completed';

type MockQueryBuilder = {
  where: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  take: ReturnType<typeof vi.fn>;
  getOne: ReturnType<typeof vi.fn>;
};

function makeQueryBuilder(
  resolvedRow: Partial<EventLedger> | null,
): MockQueryBuilder {
  return {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(resolvedRow),
  };
}

function makeReader(qb: MockQueryBuilder): AgentEndSignalReader {
  const repository = {
    createQueryBuilder: vi.fn().mockReturnValue(qb),
  } as unknown as Repository<EventLedger>;
  return new AgentEndSignalReader(repository);
}

describe('AgentEndSignalReader', () => {
  it('returns endedAtMs and outcome:success and asserts query filters for a success row', async () => {
    const occurredAt = new Date('2026-06-01T12:00:00.000Z');
    const qb = makeQueryBuilder({
      id: 'event-1',
      outcome: 'success',
      occurred_at: occurredAt,
    });
    const reader = makeReader(qb);

    const result = await reader.findLatest('run-abc', 'step-xyz');

    expect(result).toEqual({
      endedAtMs: occurredAt.getTime(),
      outcome: 'success',
    });
    expect(qb.where).toHaveBeenCalledWith('event.domain = :domain', {
      domain: AGENT_COMPLETED_DOMAIN,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('event.event_name = :eventName', {
      eventName: AGENT_COMPLETED_EVENT_NAME,
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      'event.workflow_run_id = :workflowRunId',
      { workflowRunId: 'run-abc' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('event.step_id = :stepId', {
      stepId: 'step-xyz',
    });
    expect(qb.orderBy).toHaveBeenCalledWith('event.occurred_at', 'DESC');
    expect(qb.take).toHaveBeenCalledWith(1);
  });

  it('returns outcome:failure when the latest row outcome is failure', async () => {
    const occurredAt = new Date('2026-06-02T08:30:00.000Z');
    const qb = makeQueryBuilder({
      id: 'event-2',
      outcome: 'failure',
      occurred_at: occurredAt,
    });
    const reader = makeReader(qb);

    const result = await reader.findLatest('run-def', 'step-abc');

    expect(result).toEqual({
      endedAtMs: occurredAt.getTime(),
      outcome: 'failure',
    });
  });

  it('returns null when no matching row exists', async () => {
    const qb = makeQueryBuilder(null);
    const reader = makeReader(qb);

    const result = await reader.findLatest('run-no-match', 'step-no-match');

    expect(result).toBeNull();
  });
});
