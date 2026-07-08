export interface CommitVerificationResult {
  status: 'verified' | 'needs_commit';
  uncommittedFiles: string[];
}
