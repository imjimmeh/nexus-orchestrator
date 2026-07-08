import { Injectable } from '@nestjs/common';

/**
 * Per-parent-container mutual-exclusion lock for subagent operations.
 *
 * Consumed by `SubagentOrchestratorService` (the restored facade at
 * `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`)
 * via the focused inner services. The orchestrator must serialize spawn /
 * cancellation work for the same parent container so that capacity checks,
 * file overlap checks, and DB mutations are not interleaved across
 * concurrent callers. The locking primitive is kept isolated here so it
 * can be tested and reused in isolation (SRP).
 */
@Injectable()
export class SubagentParentLockService {
  private readonly locks = new Map<string, Promise<unknown>>();

  async runExclusive<T>(
    parentContainerId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(parentContainerId) || Promise.resolve();

    const next = previous.catch(() => undefined).then(() => task());
    const trackedLock = next.then(() => undefined).catch(() => undefined);

    this.locks.set(parentContainerId, trackedLock);

    return next.finally(() => {
      if (this.locks.get(parentContainerId) === trackedLock) {
        this.locks.delete(parentContainerId);
      }
    });
  }
}
