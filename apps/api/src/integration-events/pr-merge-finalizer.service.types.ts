export interface FinalizeMergedByIdentityInput {
  provider: string;
  owner: string;
  repo: string;
  prNumber: number;
  mergeCommitSha: string;
}
