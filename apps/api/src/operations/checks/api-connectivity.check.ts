import { Injectable } from '@nestjs/common';
import type { DoctorCheck } from './doctor-check.types';
import type { DoctorCheckResult, DoctorCheckStatus } from '../doctor.types';
import { EventLedgerRepository } from '../../runtime/database/repositories/event-ledger.repository';

@Injectable()
export class ApiConnectivityCheckService implements DoctorCheck {
  readonly checkId = 'api_connectivity_detector';

  constructor(private readonly eventLedger: EventLedgerRepository) {}

  async run(): Promise<DoctorCheckResult> {
    // Query for tool execution failures with "fetch failed" in past 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [failures] = await this.eventLedger.query({
      domain: 'tool',
      event_name: 'tool.execution.completed',
      outcome: 'failure',
      occurred_after: oneDayAgo,
      limit: 1000,
    });

    // Filter for fetch-failed errors (API connectivity issues)
    const fetchFailures = failures.filter((f) =>
      this.isFetchError(f.error_message),
    );

    // Group by workflow run to find affected runs
    const affectedWorkflows = new Set<string>();
    fetchFailures.forEach((f) => {
      if (f.workflow_run_id) {
        affectedWorkflows.add(f.workflow_run_id);
      }
    });

    const status = this.resolveStatus(fetchFailures.length);
    const summary = this.buildSummary(
      fetchFailures.length,
      affectedWorkflows.size,
    );

    return {
      check_id: this.checkId,
      status,
      evidence: {
        summary,
        details: {
          fetch_failed_errors_24h: fetchFailures.length,
          affected_workflow_runs: Array.from(affectedWorkflows).slice(0, 5),
          affected_tools: Array.from(
            new Set(
              fetchFailures
                .map((f) => f.tool_name)
                .filter((t) => t !== null && t !== undefined),
            ),
          ).slice(0, 5),
          sample_errors: fetchFailures.slice(0, 3).map((f) => ({
            occurred_at: f.occurred_at,
            tool: f.tool_name,
            workflow_run_id: f.workflow_run_id,
            error: f.error_message,
          })),
        },
      },
      repair_action_id:
        fetchFailures.length > 0 ? 'recover_api_fetch_failures' : undefined,
    };
  }

  private isFetchError(message: unknown): boolean {
    if (typeof message !== 'string') {
      return false;
    }

    const lowerMessage = message.toLowerCase();
    return (
      lowerMessage.includes('fetch') ||
      lowerMessage.includes('econnrefused') ||
      lowerMessage.includes('timeout')
    );
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

  private buildSummary(failureCount: number, workflowCount: number): string {
    if (failureCount === 0) {
      return 'No API connectivity or fetch failures detected.';
    }

    return `Detected ${failureCount} API fetch failure(s) affecting ${workflowCount} workflow run(s) in past 24 hours.`;
  }
}
