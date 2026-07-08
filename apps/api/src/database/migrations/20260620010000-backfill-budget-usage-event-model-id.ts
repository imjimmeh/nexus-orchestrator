import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Links existing budget_usage_events to the concrete llm_models row that
 * produced them and recomputes any costs that were left unpriced because the
 * cost was originally resolved by model name alone.
 *
 * Provider strings on historical events were not normalised (e.g. `deepseek`
 * vs the configured `DeepSeek`), so matching is case-insensitive on the
 * provider+name pair, falling back to name-only. Rows whose token counts were
 * never captured (the legacy chat path recorded zero tokens) cannot have their
 * cost reconstructed and intentionally remain `unknown`.
 */
export class BackfillBudgetUsageEventModelId20260620010000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Resolve model_id by case-insensitive provider + name (oldest wins).
    await queryRunner.query(`
      UPDATE budget_usage_events AS e
      SET model_id = (
        SELECT m.id
        FROM llm_models AS m
        WHERE m.is_active = true
          AND LOWER(m.provider_name) = LOWER(e.provider_name)
          AND LOWER(m.name) = LOWER(e.model_name)
        ORDER BY m.created_at ASC
        LIMIT 1
      )
      WHERE e.model_id IS NULL
        AND e.provider_name IS NOT NULL
        AND e.model_name IS NOT NULL;
    `);

    // 2. Fallback: resolve remaining rows by name only.
    await queryRunner.query(`
      UPDATE budget_usage_events AS e
      SET model_id = (
        SELECT m.id
        FROM llm_models AS m
        WHERE m.is_active = true
          AND LOWER(m.name) = LOWER(e.model_name)
        ORDER BY m.created_at ASC
        LIMIT 1
      )
      WHERE e.model_id IS NULL
        AND e.model_name IS NOT NULL;
    `);

    // 3. Recompute costs for unpriced rows that do have token counts.
    await queryRunner.query(`
      UPDATE budget_usage_events AS e
      SET
        estimated_cost_cents = CASE
          WHEN e.input_tokens IS NOT NULL AND e.output_tokens IS NOT NULL THEN
            CEIL(
              (e.input_tokens::numeric * m.input_token_cents_per_million::numeric
               + e.output_tokens::numeric * m.output_token_cents_per_million::numeric)
              / 1000000
            )::integer
          ELSE
            CEIL(
              (e.total_tokens::numeric * m.input_token_cents_per_million::numeric)
              / 1000000
            )::integer
        END,
        estimate_source = 'model_rate'
      FROM llm_models AS m
      WHERE e.model_id = m.id
        AND e.estimated_cost_cents IS NULL
        AND e.total_tokens IS NOT NULL
        AND e.total_tokens > 0
        AND m.input_token_cents_per_million IS NOT NULL
        AND m.output_token_cents_per_million IS NOT NULL;
    `);
  }

  public async down(): Promise<void> {
    // No-op: backfilled model_id and recomputed costs are indistinguishable
    // from values written by normal operation, so reverting them is unsafe.
  }
}
