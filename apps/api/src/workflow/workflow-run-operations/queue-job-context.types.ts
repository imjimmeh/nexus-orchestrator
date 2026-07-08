/**
 * Shared types for `queue-job-context.helpers.ts`.
 *
 * Kept in a dedicated `.types.ts` file per the project's
 * `no-restricted-syntax` rule that requires exported interfaces to live
 * alongside type aliases in a per-module types module.
 */
export interface QueueJobContext {
  workflowRunId: string;
  jobId?: string;
}
