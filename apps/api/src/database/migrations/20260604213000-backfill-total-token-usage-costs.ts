import { MigrationInterface, QueryRunner } from 'typeorm';
import { gunzipSync } from 'node:zlib';

interface RecoverableUsageRow {
  id: string;
  total_tokens: number | string;
  input_token_cents_per_million: number | string;
  output_token_cents_per_million: number | string;
  jsonl_data: unknown;
}

interface UsageTokens {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }

  return null;
}

function readTokenCount(
  record: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const tokenCount = readInteger(record[key]);
    if (tokenCount !== null) {
      return tokenCount;
    }
  }

  return null;
}

function readUsageTokens(value: unknown): UsageTokens | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    inputTokens: readTokenCount(value, [
      'input',
      'inputTokens',
      'input_tokens',
      'promptTokens',
      'prompt_tokens',
    ]),
    outputTokens: readTokenCount(value, [
      'output',
      'outputTokens',
      'output_tokens',
      'completionTokens',
      'completion_tokens',
    ]),
    totalTokens: readTokenCount(value, ['totalTokens', 'total_tokens']),
  };
}

function findMatchingUsageTokens(
  value: unknown,
  totalTokens: number,
): UsageTokens | null {
  let match: UsageTokens | null = null;

  function visit(current: unknown): void {
    const tokens = readUsageTokens(current);
    if (
      tokens?.totalTokens === totalTokens &&
      tokens.inputTokens !== null &&
      tokens.outputTokens !== null
    ) {
      match = tokens;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }

    if (!isRecord(current)) {
      return;
    }

    for (const item of Object.values(current)) {
      visit(item);
    }
  }

  visit(value);

  return match;
}

function decodeJsonlData(jsonlData: unknown): string | null {
  if (!Array.isArray(jsonlData) || typeof jsonlData[0] !== 'string') {
    return null;
  }

  try {
    return gunzipSync(Buffer.from(jsonlData[0], 'base64')).toString('utf8');
  } catch {
    return null;
  }
}

function recoverUsageTokensFromJsonl(
  jsonlData: unknown,
  totalTokens: number,
): UsageTokens | null {
  const jsonl = decodeJsonlData(jsonlData);
  if (!jsonl) {
    return null;
  }

  let match: UsageTokens | null = null;

  for (const line of jsonl.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      match = findMatchingUsageTokens(parsed, totalTokens) ?? match;
    } catch {
      continue;
    }
  }

  return match;
}

function calculateEstimatedCostCents(params: {
  inputTokens: number;
  outputTokens: number;
  inputRate: number;
  outputRate: number;
}): number {
  return Math.ceil(
    (params.inputTokens * params.inputRate +
      params.outputTokens * params.outputRate) /
      1000000,
  );
}

function toInteger(value: number | string): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export class BackfillTotalTokenUsageCosts20260604213000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.backfillExactUsageFromSessions(queryRunner);

    await queryRunner.query(`
      UPDATE budget_usage_events AS e
      SET
        estimated_cost_cents = CEIL(
          (e.total_tokens::numeric * m.input_token_cents_per_million::numeric)
          / 1000000
        )::integer,
        estimate_source = 'model_rate'
      FROM llm_models AS m
      WHERE e.estimated_cost_cents IS NULL
        AND e.estimate_source = 'unknown'
        AND e.input_tokens IS NULL
        AND e.output_tokens IS NULL
        AND e.total_tokens IS NOT NULL
        AND e.model_name = m.name
        AND m.is_active = true
        AND m.input_token_cents_per_million IS NOT NULL
        AND m.output_token_cents_per_million IS NOT NULL;
    `);
  }

  private async backfillExactUsageFromSessions(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const rows = (await queryRunner.query(`
      SELECT
        e.id::text AS id,
        e.total_tokens,
        m.input_token_cents_per_million,
        m.output_token_cents_per_million,
        t.jsonl_data
      FROM budget_usage_events AS e
      INNER JOIN llm_models AS m
        ON e.model_name = m.name
       AND m.is_active = true
      INNER JOIN pi_session_trees AS t
        ON t.workflow_run_id::text = e.context_id
      WHERE e.estimated_cost_cents IS NULL
        AND e.estimate_source = 'unknown'
        AND e.input_tokens IS NULL
        AND e.output_tokens IS NULL
        AND e.total_tokens IS NOT NULL
        AND e.context_type = 'workflow_run'
        AND m.input_token_cents_per_million IS NOT NULL
        AND m.output_token_cents_per_million IS NOT NULL
        AND jsonb_array_length(t.jsonl_data) > 0;
    `)) as RecoverableUsageRow[];

    for (const row of rows) {
      const totalTokens = toInteger(row.total_tokens);
      const inputRate = toInteger(row.input_token_cents_per_million);
      const outputRate = toInteger(row.output_token_cents_per_million);
      if (totalTokens === null || inputRate === null || outputRate === null) {
        continue;
      }

      const usage = recoverUsageTokensFromJsonl(row.jsonl_data, totalTokens);
      if (!usage || usage.inputTokens === null || usage.outputTokens === null) {
        continue;
      }

      const estimatedCostCents = calculateEstimatedCostCents({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        inputRate,
        outputRate,
      });

      await queryRunner.query(
        `
          UPDATE budget_usage_events
          SET
            input_tokens = $1,
            output_tokens = $2,
            estimated_cost_cents = $3,
            estimate_source = 'model_rate'
          WHERE id = $4
            AND estimated_cost_cents IS NULL
            AND estimate_source = 'unknown';
        `,
        [usage.inputTokens, usage.outputTokens, estimatedCostCents, row.id],
      );
    }
  }

  public async down(): Promise<void> {
    // No-op: reverted rows are indistinguishable from valid new estimates.
  }
}
