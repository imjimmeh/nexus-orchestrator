import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Stores a pgvector embedding for a memory domain record.
 *
 * One row per (owner, embedding-model): the UNIQUE constraint lets each
 * owner record (memory_segment or learning_candidate) hold one embedding
 * per active model. Changing the active model from 384-d to 1536-d means
 * inserting a new row under a different model_id — no DDL change required.
 *
 * The `embedding` column is mapped as `text` in TypeORM because TypeORM
 * has no native `vector` column type. pgvector accepts its text literal
 * format `'[0.1,0.2,...]'` for INSERT/UPDATE, and returns the same format
 * on SELECT. The repository serialises `number[]` → `'[n1,n2,...]'` before
 * persisting and the raw-SQL cosine queries (`<=>`) consume the column
 * directly, so the TypeORM mapping only needs to round-trip the literal.
 *
 * The `dim` column records the vector width. The application enforces
 * `embedding.length === dim` before calling
 * {@link MemoryEmbeddingRepository.upsert}, giving a cheap guard against
 * mixed-dimension inserts under the same model_id.
 */
@Entity('memory_embeddings')
@Unique('UQ_memory_embeddings_owner_model', [
  'owner_type',
  'owner_id',
  'model_id',
])
@Index('idx_memory_embeddings_owner', ['owner_type', 'owner_id'])
@Index('idx_memory_embeddings_model', ['model_id'])
export class MemoryEmbedding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The owning domain object type.
   * Expected values: `'memory_segment'` | `'learning_candidate'`.
   * Stored as plain `text` so new owner types can be added without a
   * schema change.
   */
  @Column({ type: 'text' })
  owner_type!: string;

  /** UUID of the owning record (memory_segments.id or learning_candidates.id). */
  @Column({ type: 'uuid' })
  owner_id!: string;

  /**
   * UUID of the active embedding model (llm_models.id).
   * No FK decorator — cross-module FK enforcement is done at the
   * application layer per project convention.
   */
  @Column({ type: 'uuid' })
  model_id!: string;

  /**
   * Number of dimensions in the embedding vector.
   * The repository asserts `embedding.length === dim` before persisting.
   */
  @Column({ type: 'int' })
  dim!: number;

  /**
   * The pgvector embedding stored as a text literal (`'[0.1,0.2,...]'`).
   *
   * TypeORM has no native `vector` type, so we store the column as `text`
   * and let pgvector coerce on write. Raw KNN queries (`ORDER BY embedding
   * <=> $1::vector`) work transparently because pgvector will cast `text`
   * to `vector` when the operator is applied.
   *
   * On read, TypeORM returns the pgvector text representation unchanged; the
   * caller is responsible for parsing it back to `number[]` if needed.
   */
  @Column({ type: 'text' })
  embedding!: string;

  /**
   * SHA/hash of the source content at embedding time.
   * Used to detect stale embeddings when the underlying memory segment or
   * learning candidate content changes — if `content_hash` mismatches the
   * current content hash the embedding should be refreshed.
   */
  @Column({ type: 'text' })
  content_hash!: string;

  /** Wall-clock timestamp the row was first inserted. */
  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
