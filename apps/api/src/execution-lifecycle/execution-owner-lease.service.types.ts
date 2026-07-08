export interface ActiveExecutionLease {
  claimed: boolean;
  stop(): Promise<void> | void;
}
