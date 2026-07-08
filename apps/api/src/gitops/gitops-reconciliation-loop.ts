import type { GitOpsLoopParams } from './gitops-reconciliation-loop.types';

export class GitOpsReconciliationLoop {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly params: GitOpsLoopParams) {}

  start(): void {
    if (!this.params.isEnabled()) {
      this.params.logger.log(
        'GitOps reconciliation loop disabled by configuration',
      );
      return;
    }
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.params.isEnabled()) return;
    const random = this.params.random ?? Math.random;
    const jitterOffset = Math.floor(random() * this.params.jitterMs);
    const delay = this.params.intervalMs + jitterOffset;
    this.timer = setTimeout(() => {
      this.runTickGuarded();
    }, delay);
    // Prevent the timer from keeping the Node.js process alive in test/shutdown scenarios.
    this.timer.unref?.();
  }

  private runTickGuarded(): void {
    if (this.running) {
      this.params.logger.warn(
        'Skipping GitOps reconcile tick: previous tick still running',
      );
      return;
    }
    this.running = true;
    this.params.runTick().then(
      () => {
        this.running = false;
        this.scheduleNext();
      },
      (error: unknown) => {
        this.params.logger.warn(
          `Scheduled GitOps reconcile failed: ${(error as Error).message}`,
        );
        this.running = false;
        this.scheduleNext();
      },
    );
  }
}
