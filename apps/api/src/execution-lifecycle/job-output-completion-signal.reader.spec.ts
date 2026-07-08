import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { JobOutputCompletionSignalReader } from './job-output-completion-signal.reader';
import type { EventLedger } from '../runtime/database/entities/event-ledger.entity';

const OUTPUT_PERSISTED_DOMAIN = 'workflow';
const OUTPUT_PERSISTED_EVENT_NAME = 'workflow.agent.output_persisted';

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

/**
 * Builds a reader whose repository returns the supplied query builders in order:
 * the first call resolves the output-persisted lookup, the second the latest
 * activity lookup.
 */
function makeReader(builders: MockQueryBuilder[]): {
  reader: JobOutputCompletionSignalReader;
  createQueryBuilder: ReturnType<typeof vi.fn>;
} {
  const createQueryBuilder = vi.fn();
  builders.forEach((qb) => createQueryBuilder.mockReturnValueOnce(qb));
  const repository = {
    createQueryBuilder,
  } as unknown as Repository<EventLedger>;
  return {
    reader: new JobOutputCompletionSignalReader(repository),
    createQueryBuilder,
  };
}

describe('JobOutputCompletionSignalReader', () => {
  it('returns persisted and latest-activity timestamps and asserts the output-persisted filters', async () => {
    const persistedAt = new Date('2026-06-24T15:55:08.000Z');
    const latestActivityAt = new Date('2026-06-24T15:55:09.000Z');
    const persistedQb = makeQueryBuilder({
      id: 'persist-1',
      occurred_at: persistedAt,
    });
    const activityQb = makeQueryBuilder({
      id: 'activity-1',
      occurred_at: latestActivityAt,
    });
    const { reader } = makeReader([persistedQb, activityQb]);

    const result = await reader.findCompletionCandidate('run-abc', 'job-xyz');

    expect(result).toEqual({
      outputPersistedAtMs: persistedAt.getTime(),
      latestActivityMs: latestActivityAt.getTime(),
    });
    expect(persistedQb.where).toHaveBeenCalledWith('event.domain = :domain', {
      domain: OUTPUT_PERSISTED_DOMAIN,
    });
    expect(persistedQb.andWhere).toHaveBeenCalledWith(
      'event.event_name = :eventName',
      { eventName: OUTPUT_PERSISTED_EVENT_NAME },
    );
    expect(persistedQb.andWhere).toHaveBeenCalledWith(
      'event.workflow_run_id = :workflowRunId',
      { workflowRunId: 'run-abc' },
    );
    expect(persistedQb.andWhere).toHaveBeenCalledWith(
      'event.step_id = :stepId',
      {
        stepId: 'job-xyz',
      },
    );
  });

  it('keys the latest-activity lookup by job_id and orders by occurred_at desc', async () => {
    const persistedQb = makeQueryBuilder({
      id: 'persist-1',
      occurred_at: new Date('2026-06-24T15:55:08.000Z'),
    });
    const activityQb = makeQueryBuilder({
      id: 'activity-1',
      occurred_at: new Date('2026-06-24T15:55:09.000Z'),
    });
    const { reader } = makeReader([persistedQb, activityQb]);

    await reader.findCompletionCandidate('run-abc', 'job-xyz');

    expect(activityQb.where).toHaveBeenCalledWith(
      'event.workflow_run_id = :workflowRunId',
      { workflowRunId: 'run-abc' },
    );
    expect(activityQb.andWhere).toHaveBeenCalledWith('event.job_id = :jobId', {
      jobId: 'job-xyz',
    });
    expect(activityQb.orderBy).toHaveBeenCalledWith(
      'event.occurred_at',
      'DESC',
    );
    expect(activityQb.take).toHaveBeenCalledWith(1);
  });

  it('returns null when no output-persisted signal exists (no second query run)', async () => {
    const persistedQb = makeQueryBuilder(null);
    const { reader, createQueryBuilder } = makeReader([persistedQb]);

    const result = await reader.findCompletionCandidate('run-none', 'job-none');

    expect(result).toBeNull();
    expect(createQueryBuilder).toHaveBeenCalledTimes(1);
  });

  it('falls back to the persisted timestamp when no activity row is found', async () => {
    const persistedAt = new Date('2026-06-24T15:55:08.000Z');
    const persistedQb = makeQueryBuilder({
      id: 'persist-1',
      occurred_at: persistedAt,
    });
    const activityQb = makeQueryBuilder(null);
    const { reader } = makeReader([persistedQb, activityQb]);

    const result = await reader.findCompletionCandidate('run-abc', 'job-xyz');

    expect(result).toEqual({
      outputPersistedAtMs: persistedAt.getTime(),
      latestActivityMs: persistedAt.getTime(),
    });
  });

  it('finds the latest job activity by workflow run and job id', async () => {
    const latestActivityAt = new Date('2026-06-30T12:03:00.000Z');
    const activityQb = makeQueryBuilder({
      id: 'activity-1',
      occurred_at: latestActivityAt,
    });
    const { reader } = makeReader([activityQb]);

    const result = await reader.findLatestJobActivity('run-abc', 'job-xyz');

    expect(result).toEqual({ latestActivityMs: latestActivityAt.getTime() });
    expect(activityQb.where).toHaveBeenCalledWith(
      'event.workflow_run_id = :workflowRunId',
      { workflowRunId: 'run-abc' },
    );
    expect(activityQb.andWhere).toHaveBeenCalledWith('event.job_id = :jobId', {
      jobId: 'job-xyz',
    });
    expect(activityQb.orderBy).toHaveBeenCalledWith(
      'event.occurred_at',
      'DESC',
    );
    expect(activityQb.take).toHaveBeenCalledWith(1);
  });

  it('returns null when no latest job activity exists', async () => {
    const activityQb = makeQueryBuilder(null);
    const { reader } = makeReader([activityQb]);

    await expect(
      reader.findLatestJobActivity('run-none', 'job-none'),
    ).resolves.toBeNull();
  });
});
