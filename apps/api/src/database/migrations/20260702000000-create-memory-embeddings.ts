import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `memory_embeddings` table for dimension-native vector storage.
 *
 * Design goals:
 *  - One row per (owner, model): the UNIQUE(owner_type, owner_id, model_id)
 *    constraint allows each owning record to have one embedding per embedding
 *    model. Swapping models (384-d ↔ 1536-d) just inserts/updates under a
 *    different model_id without a schema change.
 *  - Unbounded `vector` column (NOT `vector(N)`): pgvector permits a
 *    dimension-unspecified vector column that accepts any vector regardless of
 *    width. This lets 384-d and 1536-d embeddings coexist under different
 *    model_ids in the same table with no DDL change when the active model
 *    changes. The application layer enforces the per-row invariant
 *    `embedding.length === dim` before insert.
 *  - No ANN index (HNSW / IVFFlat): pgvector cannot index an unbounded vector
 *    column because the operator class requires a fixed dimension. Retrieval
 *    uses exact scope-filtered KNN (`<=>` cosine distance) — scoped queries
 *    keep the working set small enough that a seqscan on the scope slice is
 *    fast. An ANN index can be added on a dimension-specific materialized view
 *    in a later task if needed.
 *  - No FK on model_id: follows the project convention of avoiding
 *    cross-module foreign keys in migrations; referential integrity for
 *    llm_models.id is enforced at the application layer.
 */
export class CreateMemoryEmbeddings20260702000000 implements MigrationInterface {
  public readonly transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        "id"           uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "owner_type"   text        NOT NULL,
        "owner_id"     uuid        NOT NULL,
        "model_id"     uuid        NOT NULL,
        "dim"          int         NOT NULL,
        "embedding"    vector      NOT NULL,
        "content_hash" text        NOT NULL,
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_memory_embeddings_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_memory_embeddings_owner_model" UNIQUE ("owner_type", "owner_id", "model_id")
      );
    `);

    // Covers per-owner lookups: "all embeddings for this memory_segment"
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_memory_embeddings_owner
        ON memory_embeddings ("owner_type", "owner_id");
    `);

    // Covers per-model lookups: "all embeddings from this embedding model"
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model
        ON memory_embeddings ("model_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS memory_embeddings;`);
  }
}
