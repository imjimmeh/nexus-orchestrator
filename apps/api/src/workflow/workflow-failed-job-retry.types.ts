export interface FailedJobRetryResult {
  retried: true;
  failedJobId: string;
}

export interface FailedJobRetryResolvedContext {
  failedJobId: string;
}
