/**
 * Durable, crash-safe completion candidate for a `workflow_step` execution,
 * reconstructed purely from the event ledger. Returned by
 * {@link JobOutputCompletionSignalReader.findCompletionCandidate} when the job
 * has emitted a `workflow.agent.output_persisted` signal (the agent produced its
 * terminal output via `set_job_output`).
 */
export type JobOutputCompletionCandidate = {
  /** Epoch ms of the most recent `workflow.agent.output_persisted` signal. */
  outputPersistedAtMs: number;
  /**
   * Epoch ms of the most recent ledger activity for the job (any event keyed by
   * its `job_id`). Used by the supervisor to require wall-clock quiescence
   * before reconciling, so an agent that set output mid-loop and kept working is
   * never completed prematurely.
   */
  latestActivityMs: number;
};

export type JobActivitySignal = {
  /** Epoch ms of the most recent ledger row keyed to the job. */
  latestActivityMs: number;
};
