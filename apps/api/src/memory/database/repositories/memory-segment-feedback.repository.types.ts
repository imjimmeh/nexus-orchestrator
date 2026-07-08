/**
 * Input / output types for
 * {@link MemorySegmentFeedbackRepository} (work item
 * 66ea23d1-59f2-451b-a090-a292fad8f21b, milestone 1).
 *
 * Split out of the repository file to keep the repository
 * surface narrow and to honour the project's
 * `no-restricted-syntax` lint rule that bans exported interfaces
 * from non-`.types.ts` files. The repository imports these
 * types via a relative path so the file's public surface stays
 * the same.
 *
 * Mirrors the migration's NOT NULL constraint set — the
 * repository deliberately does NOT default any of the required
 * fields, so the caller (the milestone-2 service) is forced to
 * think about every column at the call site. `reason` is the
 * only optional field.
 */
export interface MemorySegmentFeedbackInput {
  segment_id: string;
  query_id: string;
  agent_profile_id: string;
  workflow_run_id: string;
  useful: boolean;
  reason?: string | null;
}
