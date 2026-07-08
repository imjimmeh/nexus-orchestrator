import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

/**
 * Adds a unique B-tree index on `refresh_tokens.token_hash` to back the
 * HMAC-SHA-256 based deterministic refresh-token hashing introduced alongside
 * this migration.
 *
 * The legacy `token_hash` column stored bcrypt digests (different value per
 * round), so lookups in `RefreshTokenService` / `RefreshTokenRepository` had
 * to fall back to O(n) scans (load every row, bcrypt-compare in code). With
 * the deterministic HMAC SHA-256 hash (64-char hex) we can rely on a unique
 * index for O(1) equality lookups via `RefreshTokenRepository.findByTokenHash`,
 * which is on the hot path of every refresh-token exchange.
 *
 * Uniqueness is also enforced at the DB layer: two rows with the same
 * `token_hash` would be a hard invariant violation (the hash is a pure
 * function of the secret + plain token), so a UNIQUE constraint is the right
 * shape rather than a plain non-unique index.
 *
 * ⚠️ BREAKING DEPLOY NOTE: rows that pre-date this migration store bcrypt
 * hashes in `token_hash`. Those rows are unreachable after deploy because the
 * new code path compares raw HMAC hashes. Operators MUST truncate
 * `refresh_tokens` (or run a one-time re-auth) before applying this migration
 * in environments with existing data. Documented in the PR description.
 */
export class AddRefreshTokensTokenHashUniqueIndex20260630000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createIndex(
      'refresh_tokens',
      new TableIndex({
        name: 'UQ_refresh_tokens_token_hash',
        columnNames: ['token_hash'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'refresh_tokens',
      'UQ_refresh_tokens_token_hash',
    );
  }
}
