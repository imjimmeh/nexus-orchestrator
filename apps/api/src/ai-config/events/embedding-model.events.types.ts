/**
 * Payload for the `embedding.active_model.changed` domain event.
 *
 * Emitted by {@link AiConfigAdminService} whenever an `llm_models` row
 * transitions to become the active embedding model — either by setting
 * `default_for_embedding=true` on a new row, or by changing the
 * `embedding_dimension` of the already-active row. Consumers should use
 * this event to trigger a corpus re-embed under the new model.
 */
export interface EmbeddingActiveModelChangedEvent {
  /** The `llm_models.id` of the newly active embedding model. */
  activeModelId: string;
  /**
   * The `llm_models.id` of the previously active model, when known.
   * `undefined` when the model was not previously set (first configuration).
   */
  previousModelId?: string;
}
