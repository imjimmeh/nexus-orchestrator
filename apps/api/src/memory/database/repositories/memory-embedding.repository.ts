import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { MemoryEmbedding } from '../entities/memory-embedding.entity';
import type { UpsertEmbeddingInput } from './memory-embedding.repository.types';

export type { UpsertEmbeddingInput } from './memory-embedding.repository.types';

/**
 * Persistence surface for dimension-native pgvector embeddings.
 *
 * Each call to {@link upsert} either inserts a new row or replaces an
 * existing one for the (owner_type, owner_id, model_id) triple. The method
 * enforces `embedding.length === dim` before writing; passing a mismatched
 * array throws a descriptive error so the caller never silently persists a
 * corrupted embedding.
 *
 * KNN / cosine-distance queries (`ORDER BY embedding <=> $1`) are done via
 * raw SQL in higher-level services and are not exposed here — this repository
 * owns only the write surface.
 */
@Injectable()
export class MemoryEmbeddingRepository {
  constructor(
    @InjectRepository(MemoryEmbedding)
    private readonly repository: Repository<MemoryEmbedding>,
  ) {}

  /** Exposes the TypeORM EntityManager for raw KNN queries in EmbeddingSimilarityService. */
  get manager(): EntityManager {
    return this.repository.manager;
  }

  /**
   * Insert or replace the embedding for a given owner + model pair.
   *
   * Uses TypeORM's `save()` with the UNIQUE constraint
   * `UQ_memory_embeddings_owner_model` as the conflict target (DELETE +
   * INSERT semantics via `findOne` + `save`). The `embedding` number[] is
   * serialised to the pgvector text literal `'[n1,n2,...]'` before
   * persistence so pgvector's `<=>` operator can consume it directly in
   * subsequent raw-SQL queries.
   *
   * @throws {Error} if `input.embedding.length !== input.dim` (dimension mismatch guard).
   */
  async upsert(input: UpsertEmbeddingInput): Promise<MemoryEmbedding> {
    if (input.dim <= 0 || input.embedding.length !== input.dim) {
      throw new Error(
        `Dimension mismatch: dim=${input.dim} but embedding has ${input.embedding.length} values.`,
      );
    }

    const embeddingLiteral = `[${input.embedding.join(',')}]`;

    const existing = await this.repository.findOne({
      where: {
        owner_type: input.owner_type,
        owner_id: input.owner_id,
        model_id: input.model_id,
      },
    });

    const data: Partial<MemoryEmbedding> = {
      id: existing?.id,
      owner_type: input.owner_type,
      owner_id: input.owner_id,
      model_id: input.model_id,
      dim: input.dim,
      embedding: embeddingLiteral,
      content_hash: input.content_hash,
    };

    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  /**
   * Race-safe upsert using TypeORM's native `INSERT ... ON CONFLICT DO UPDATE`.
   *
   * Unlike {@link upsert}, this method does NOT perform a prior `findOne` and
   * therefore avoids a read–write race window. Prefer this method from async
   * queue consumers where concurrent writes to the same (owner, model) pair
   * are possible.
   *
   * @throws {Error} if `input.embedding.length !== input.dim` (dimension mismatch guard).
   */
  async upsertSafe(input: UpsertEmbeddingInput): Promise<void> {
    if (input.dim <= 0 || input.embedding.length !== input.dim) {
      throw new Error(
        `Dimension mismatch: dim=${input.dim} but embedding has ${input.embedding.length} values.`,
      );
    }

    const embeddingLiteral = `[${input.embedding.join(',')}]`;

    await this.repository.upsert(
      [
        {
          owner_type: input.owner_type,
          owner_id: input.owner_id,
          model_id: input.model_id,
          dim: input.dim,
          embedding: embeddingLiteral,
          content_hash: input.content_hash,
        },
      ],
      ['owner_type', 'owner_id', 'model_id'],
    );
  }

  /**
   * Find the embedding row for a given owner + model pair.
   * Returns `null` if no embedding has been stored yet.
   */
  async findByOwnerAndModel(
    owner_type: string,
    owner_id: string,
    model_id: string,
  ): Promise<MemoryEmbedding | null> {
    return this.repository.findOne({
      where: { owner_type, owner_id, model_id },
    });
  }

  /**
   * Return up to `batchSize` owner IDs of the given type that do not yet
   * have an embedding row for the specified model.
   *
   * Used by {@link EmbeddingBackfillService} to page through unembedded
   * records. `memory_segment` rows with `archived_at IS NOT NULL` are
   * excluded — archiving is considered terminal, so backfilling archived
   * segments wastes vector store space.
   */
  async findOwnersMissingEmbedding(
    ownerType: string,
    modelId: string,
    batchSize: number,
  ): Promise<string[]> {
    const ownerTable =
      ownerType === 'memory_segment'
        ? 'memory_segments'
        : 'learning_candidates';
    const archivedFilter =
      ownerType === 'memory_segment' ? 'AND o.archived_at IS NULL' : '';

    const rows = await this.repository.manager.query<Array<{ id: string }>>(
      `SELECT o.id
       FROM ${ownerTable} o
       WHERE NOT EXISTS (
         SELECT 1 FROM memory_embeddings me
         WHERE me.owner_id = o.id
           AND me.owner_type = $1
           AND me.model_id = $2
       )
       ${archivedFilter}
       ORDER BY o.created_at ASC
       LIMIT $3`,
      [ownerType, modelId, batchSize],
    );

    return rows.map((r) => r.id);
  }

  /**
   * Delete all embeddings for a given owner record (e.g. when the
   * memory_segment is archived or the learning_candidate is rejected).
   */
  async deleteByOwner(owner_type: string, owner_id: string): Promise<void> {
    await this.repository.delete({ owner_type, owner_id });
  }

  /**
   * GC reaper: delete all embedding rows whose `model_id` differs from the
   * currently active embedding model. Call this after a corpus re-embed under
   * the new active model to reclaim vector storage and avoid stale results.
   *
   * @returns The number of rows deleted.
   */
  async deleteByNonActiveModel(activeModelId: string): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(MemoryEmbedding)
      .where('model_id != :activeModelId', { activeModelId })
      .execute();
    return result.affected ?? 0;
  }
}
