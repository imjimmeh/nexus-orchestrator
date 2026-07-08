import { EventEmitter2 } from '@nestjs/event-emitter';
import type { LlmModel } from '../database/entities/llm-model.entity';
import {
  EMBEDDING_ACTIVE_MODEL_CHANGED_EVENT,
  type EmbeddingActiveModelChangedEvent,
} from './embedding-model.events';

/**
 * Emit `embedding.active_model.changed` when a model update activates a new
 * default-for-embedding row or changes the dimension on the already-active one.
 *
 * Pure helper extracted to keep AiConfigAdminService within the 500-line limit.
 * The caller must NOT await the event — it is fire-and-forget.
 */
export function emitEmbeddingModelChangedIfNeeded(
  eventEmitter: EventEmitter2,
  before: LlmModel | null,
  after: LlmModel,
): void {
  const becameDefaultForEmbedding =
    !before?.default_for_embedding && after.default_for_embedding;
  const dimensionChangedOnActiveModel =
    after.default_for_embedding &&
    before?.embedding_dimension !== after.embedding_dimension;

  if (!becameDefaultForEmbedding && !dimensionChangedOnActiveModel) {
    return;
  }

  const event: EmbeddingActiveModelChangedEvent = {
    activeModelId: after.id,
    previousModelId: before?.id,
  };
  eventEmitter.emit(EMBEDDING_ACTIVE_MODEL_CHANGED_EVENT, event);
}
