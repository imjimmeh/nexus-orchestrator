import { Injectable } from '@nestjs/common';
import type { DoctorCheck } from './doctor-check.types';
import type { DoctorCheckResult, DoctorCheckStatus } from '../doctor.types';
import { EventLedgerRepository } from '../../runtime/database/repositories/event-ledger.repository';

@Injectable()
export class GitWorktreeIntegrityCheckService implements DoctorCheck {
  readonly checkId = 'git_worktree_integrity_detector';

  constructor(private readonly eventLedger: EventLedgerRepository) {}

  async run(): Promise<DoctorCheckResult> {
    // Query for git worktree removal failures in past 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [failureEntries] = await this.eventLedger.query({
      domain: 'git',
      event_name: 'git.worktree.remove.failed',
      outcome: 'failure',
      occurred_after: sevenDaysAgo,
      limit: 1000,
    });

    const recentCount = failureEntries.length;
    const lockedErrors = failureEntries.filter((f) =>
      this.isLockedError(f.error_message),
    ).length;

    const status = this.resolveStatus(recentCount);

    const summary = this.buildSummary(recentCount, lockedErrors);

    return {
      check_id: this.checkId,
      status,
      evidence: {
        summary,
        details: {
          total_failures_7d: recentCount,
          locked_worktree_errors: lockedErrors,
          sample_errors: failureEntries.slice(0, 3).map((f) => ({
            occurred_at: f.occurred_at,
            error: f.error_message,
          })),
        },
      },
      repair_action_id: recentCount > 0 ? 'clean_git_worktrees' : undefined,
    };
  }

  private resolveStatus(failureCount: number): DoctorCheckStatus {
    if (failureCount > 20) {
      return 'fail';
    }
    if (failureCount > 0) {
      return 'warn';
    }
    return 'ok';
  }

  private isLockedError(message: unknown): boolean {
    if (typeof message !== 'string') {
      return false;
    }
    return message.toLowerCase().includes('locked');
  }

  private buildSummary(failureCount: number, lockedCount: number): string {
    if (failureCount === 0) {
      return 'No git worktree removal failures detected.';
    }

    const parts = [`Detected ${failureCount} git worktree removal failure(s)`];
    if (lockedCount > 0) {
      parts.push(`including ${lockedCount} locked worktree(s)`);
    }
    parts.push('in past 7 days.');

    return parts.join(' ');
  }
}
