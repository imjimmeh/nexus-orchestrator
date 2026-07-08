/**
 * Public input shape for
 * {@link MemorySegmentFeedbackService.recordFeedback}
 * (work item 66ea23d1-59f2-451b-a090-a292fad8f21b,
 * milestone 2).
 *
 * Decoupled from the repository's snake_case
 * `MemorySegmentFeedbackInput` because the service is the
 * boundary at which the API caller-facing shape (camelCase
 * JSON, idiomatic NestJS controller DTOs) meets the
 * persistence layer. The service is the single place that
 * translates between the two; the repository never sees the
 * camelCase surface, and the controller / tool-handler
 * callers never see the snake_case column names.
 *
 * Split out of `memory-segment-feedback.service.ts` to keep
 * the service surface narrow and to honour the project's
 * `no-restricted-syntax` lint rule that bans exported
 * interfaces from non-`.types.ts` files. Mirrors the
 * `memory-segment-feedback.repository.types.ts` shape that
 * milestone 1 established for the repository.
 */
export interface RecordFeedbackInput {
  segmentId: string;
  queryId: string;
  agentProfileId: string;
  workflowRunId: string;
  useful: boolean;
  reason?: string | null;
}
