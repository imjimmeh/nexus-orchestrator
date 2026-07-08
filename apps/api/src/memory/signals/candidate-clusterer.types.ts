/** Result summary returned by {@link CandidateClustererService.cluster}. */
export interface ClusterResult {
  /** Number of clusters (size ≥ 2) that were formed and persisted. */
  clustersFormed: number;
  /** Total number of non-canonical candidates marked `status='merged'`. */
  candidatesMerged: number;
  /** Total number of `status='pending'` candidates loaded at the start of the pass. */
  totalPending: number;
}
