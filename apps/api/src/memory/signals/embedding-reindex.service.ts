import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  EMBEDDING_ACTIVE_MODEL_CHANGED_EVENT,
  type EmbeddingActiveModelChangedEvent,
} from '../../ai-config/events/embedding-model.events';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import { MemoryEmbeddingRepository } from '../database/repositories/memory-embedding.repository';
import { EmbeddingBackfillService } from './embedding-backfill.service';

/**
 * Defensive upper bound on backfill iterations. At the default batch size of
 * 50 owners per type, 1000 iterations covers ~100k owners — far beyond any
 * realistic corpus — while guaranteeing the loop terminates even if a batch
 * pathologically always reports progress.
 */
const MAX_BACKFILL_ITERATIONS = 1000;

/**
 * Reindexes the memory-embedding corpus whenever the active embedding model
 * changes.
 *
 * Flow:
 * 1. {@link onActiveModelChanged} receives `embedding.active_model.changed`.
 * 2. Delegates to {@link reindexActiveModel} (async, off the request path).
 * 3. {@link reindexActiveModel} drives the backfill to completion — embedding
 *    every owner that lacks a row for the NEW active model — then GCs any rows
 *    whose `model_id` no longer matches the active model.
 *
 * **Phase-1 simplification:** the active-model pointer flips immediately when
 * the config change is saved. During the re-embed window, retrieval falls back
 * to lexical/recency similarity because no embeddings for the new model exist
 * yet. Zero-downtime two-phase switching (serve old-model embeddings until the
 * new set is complete, then flip) is deferred to a later phase.
 */
@Injectable()
export class EmbeddingReindexService {
  private readonly logger = new Logger(EmbeddingReindexService.name);

  constructor(
    private readonly backfill: EmbeddingBackfillService,
    private readonly embeddingRepo: MemoryEmbeddingRepository,
    private readonly aiConfig: AiConfigurationService,
  ) {}

  /**
   * Event handler: wired to `embedding.active_model.changed` via EventEmitter2.
   * Runs asynchronously — never awaited by the emitter.
   */
  @OnEvent(EMBEDDING_ACTIVE_MODEL_CHANGED_EVENT)
  async onActiveModelChanged(
    event: EmbeddingActiveModelChangedEvent,
  ): Promise<void> {
    this.logger.log(
      `Embedding reindex triggered — activeModelId=${event.activeModelId}` +
        (event.previousModelId
          ? ` (replacing ${event.previousModelId})`
          : ' (first configuration)'),
    );
    await this.reindexActiveModel();
  }

  /**
   * Re-embed the ENTIRE corpus under the active model, then prune superseded
   * rows.
   *
   * `EmbeddingBackfillService.run()` embeds at most `batchSize` owners PER TYPE
   * per call and returns — it does not loop internally. We therefore drive it
   * in a loop until a call embeds nothing more (`embedded === 0`), which means
   * every re-embeddable owner now has an active-model row. Only THEN is it safe
   * to GC the old-model rows; deleting after a single partial batch would
   * strand the rest of the corpus with no embedding.
   *
   * Fail-soft: if a `run()` call throws, the loop stops but the GC step still
   * runs so stale embeddings are not left behind indefinitely.
   */
  async reindexActiveModel(): Promise<void> {
    const config = await this.aiConfig.resolveEmbeddingModelConfig();
    if (!config.configured) {
      this.logger.log('No embedding model configured — reindex is a no-op.');
      return;
    }

    this.logger.log(
      `Starting embedding reindex under model ${config.modelId}…`,
    );

    const totalEmbedded = await this.runBackfillToCompletion();

    const deleted = await this.embeddingRepo.deleteByNonActiveModel(
      config.modelId,
    );
    this.logger.log(
      `Reindex complete — embedded ${totalEmbedded} owner(s), pruned ${deleted} superseded embedding row(s).`,
    );
  }

  /**
   * Drive {@link EmbeddingBackfillService.run} until it embeds nothing more.
   *
   * `run()` is idempotent (skips already-embedded owners via
   * `findOwnersMissingEmbedding`), so the loop terminates once the corpus is
   * fully embedded. A defensive cap guards against a pathological batch that
   * always reports progress. Returns the total owners embedded across all
   * iterations.
   */
  private async runBackfillToCompletion(): Promise<number> {
    let total = 0;
    let iterations = 0;

    try {
      let embedded = 0;
      do {
        const result = await this.backfill.run();
        embedded = result.embedded;
        total += embedded;
        iterations += 1;
      } while (embedded > 0 && iterations < MAX_BACKFILL_ITERATIONS);

      if (iterations >= MAX_BACKFILL_ITERATIONS) {
        this.logger.warn(
          `Backfill hit iteration cap (${MAX_BACKFILL_ITERATIONS}) — pruning anyway; a follow-up reindex may be required.`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Backfill failed after embedding ${total} owner(s) (will still prune stale rows): ${String(err)}`,
      );
    }

    return total;
  }
}
