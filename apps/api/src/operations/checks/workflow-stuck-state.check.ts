import { Injectable } from '@nestjs/common';
import type { DoctorCheck } from './doctor-check.types';
import {
  type DoctorCheckResult,
  type DoctorCheckStatus,
} from '../doctor.types';
import { WorkflowRecoveryCandidatesService } from '../workflow-recovery-candidates.service';

@Injectable()
export class WorkflowStuckStateCheckService implements DoctorCheck {
  readonly checkId = 'workflow_stuck_state_detector';

  constructor(
    private readonly recoveryCandidates: WorkflowRecoveryCandidatesService,
  ) {}

  async run(): Promise<DoctorCheckResult> {
    const diagnostics = await this.recoveryCandidates.inspect();

    const status = this.resolveStatus({
      staleRunningCount: diagnostics.stale_running_run_ids.length,
      recoverablePendingCount: diagnostics.recoverable_pending_run_ids.length,
      expiredOwnerLeaseCount:
        diagnostics.expired_owner_lease_execution_ids.length,
    });

    const summary = this.buildSummary({
      staleRunningCount: diagnostics.stale_running_run_ids.length,
      recoverablePendingCount: diagnostics.recoverable_pending_run_ids.length,
      expiredOwnerLeaseCount:
        diagnostics.expired_owner_lease_execution_ids.length,
    });

    return {
      check_id: this.checkId,
      status,
      evidence: {
        summary,
        details: {
          ...diagnostics,
        },
      },
      repair_action_id:
        diagnostics.recoverable_pending_run_ids.length > 0
          ? 'requeue_recoverable_workflow_runs'
          : undefined,
    };
  }

  private resolveStatus(params: {
    staleRunningCount: number;
    recoverablePendingCount: number;
    expiredOwnerLeaseCount: number;
  }): DoctorCheckStatus {
    if (params.staleRunningCount > 0) {
      return 'fail';
    }

    if (params.expiredOwnerLeaseCount > 0) {
      return 'warn';
    }

    if (params.recoverablePendingCount > 0) {
      return 'warn';
    }

    return 'ok';
  }

  private buildSummary(params: {
    staleRunningCount: number;
    recoverablePendingCount: number;
    expiredOwnerLeaseCount: number;
  }): string {
    if (params.staleRunningCount > 0) {
      return `Detected ${params.staleRunningCount.toString()} stale RUNNING workflow run(s).`;
    }

    if (params.expiredOwnerLeaseCount > 0) {
      return `Detected ${params.expiredOwnerLeaseCount.toString()} execution(s) with an expired owner lease.`;
    }

    if (params.recoverablePendingCount > 0) {
      return `Detected ${params.recoverablePendingCount.toString()} recoverable PENDING workflow run(s).`;
    }

    return 'No stuck workflow runs detected.';
  }
}
