/**
 * Canonical event name for embedding active-model changes.
 *
 * Emitted by AiConfigAdminService whenever the active embedding model is
 * switched or its dimension is updated. Consumed by EmbeddingReindexService
 * (memory-signals) via @OnEvent — the event bus keeps the two modules decoupled.
 */
export const EMBEDDING_ACTIVE_MODEL_CHANGED_EVENT =
  'embedding.active_model.changed';

export type { EmbeddingActiveModelChangedEvent } from './embedding-model.events.types';
