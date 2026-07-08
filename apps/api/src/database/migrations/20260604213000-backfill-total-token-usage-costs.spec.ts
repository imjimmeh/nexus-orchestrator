import { describe, expect, it, vi } from 'vitest';
import { QueryRunner } from 'typeorm';
import { gzipSync } from 'node:zlib';
import { registeredMigrations } from './registered-migrations';

function getMigration() {
  const Migration = registeredMigrations.find(
    (migration) =>
      migration.name === 'BackfillTotalTokenUsageCosts20260604213000',
  );

  expect(Migration).toBeDefined();

  return new Migration!();
}

describe('BackfillTotalTokenUsageCosts20260604213000', () => {
  it('backfills exact input and output token usage from matching session logs', async () => {
    const encodedJsonl = gzipSync(
      Buffer.from(
        [
          JSON.stringify({
            type: 'assistant_message',
            message: {
              usage: {
                input: 647,
                output: 391,
                cacheRead: 56_818,
                cacheWrite: 0,
                totalTokens: 57_856,
              },
            },
          }),
        ].join('\n'),
      ),
    ).toString('base64');
    const query = vi.fn<QueryRunner['query']>().mockResolvedValueOnce([
      {
        id: 'usage-1',
        total_tokens: 57_856,
        input_token_cents_per_million: 15,
        output_token_cents_per_million: 60,
        jsonl_data: [encodedJsonl],
      },
    ]);
    const queryRunner = { query } as unknown as QueryRunner;

    await getMigration().up(queryRunner);

    expect(query.mock.calls[0]?.[0]).toContain(
      'ON t.workflow_run_id::text = e.context_id',
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE budget_usage_events'),
      [647, 391, 1, 'usage-1'],
    );
  });

  it('backfills unknown total-token usage with active model input rates', async () => {
    const query = vi.fn<QueryRunner['query']>().mockResolvedValue([]);
    const queryRunner = { query } as unknown as QueryRunner;

    await getMigration().up(queryRunner);

    const joinedStatements = query.mock.calls
      .map(([statement]) => statement)
      .join('\n');

    expect(joinedStatements).toContain('UPDATE budget_usage_events AS e');
    expect(joinedStatements).toContain('FROM llm_models AS m');
    expect(joinedStatements).toContain('CEIL(');
    expect(joinedStatements).toContain("estimate_source = 'model_rate'");
    expect(joinedStatements).toContain("e.estimate_source = 'unknown'");
    expect(joinedStatements).toContain('e.total_tokens IS NOT NULL');
  });

  it('is registered so TypeORM applies it at startup', () => {
    expect(registeredMigrations.map((migration) => migration.name)).toContain(
      'BackfillTotalTokenUsageCosts20260604213000',
    );
  });
});
