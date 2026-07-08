import { Injectable, Logger } from '@nestjs/common';
import { ExecutionRepository } from './database/repositories/execution.repository';
import type { SessionRehydrator } from './startup-resume.coordinator.types';

/**
 * Startup fallback for executions whose container vanished across a full host
 * restart (the freeze-on-shutdown sweep paused live containers; this path only
 * runs when the container is no longer present at all).
 *
 * Re-provisioning a fresh container from scratch requires the full step
 * executor pipeline — runner-config storage, JWT minting, AI-config resolution,
 * worktree resolution, and tier selection — which is execution-kind specific and
 * not generically reusable here (see SubagentParentResumeService for the
 * subagent-only variant). Rather than duplicate that machinery, this adapter
 * degrades gracefully: it logs that the execution cannot be auto-rehydrated and
 * returns false. workflow_step executions are still recovered by the existing
 * stale-run reconciliation; chat executions require manual/operator recovery.
 */
@Injectable()
export class SessionRehydratorAdapter implements SessionRehydrator {
  private readonly logger = new Logger(SessionRehydratorAdapter.name);

  constructor(private readonly executions: ExecutionRepository) {}

  async rehydrateAndResume(executionId: string): Promise<boolean> {
    const execution = await this.executions.findById(executionId);
    const kind = execution?.kind ?? 'unknown';

    this.logger.warn(
      `Execution ${executionId} (kind=${kind}) was frozen but its container is ` +
        `gone; automatic session rehydration is not available for this path. ` +
        `Leaving it to stale-run reconciliation / manual recovery.`,
    );

    return false;
  }
}
