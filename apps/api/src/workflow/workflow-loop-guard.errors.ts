export class MaxLoopIterationsExceededError extends Error {
  readonly jobId: string;
  readonly nextJobId: string;

  constructor(jobId: string, nextJobId: string) {
    super(`max_loop_iterations: ${jobId} -> ${nextJobId}`);
    this.name = MaxLoopIterationsExceededError.name;
    this.jobId = jobId;
    this.nextJobId = nextJobId;
  }
}
