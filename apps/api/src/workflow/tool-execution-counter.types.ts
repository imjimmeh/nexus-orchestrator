/**
 * Counts successful executions of a tool within a single workflow job, used to
 * reconcile agent-reported output counts against work the agent actually did.
 * Abstracts the observability ledger so output-contract validation does not
 * depend on a concrete event store (DIP).
 */
export interface IToolExecutionCounter {
  countSuccessfulToolExecutions(params: {
    workflowRunId: string;
    jobId: string;
    toolName: string;
  }): Promise<number>;
}
