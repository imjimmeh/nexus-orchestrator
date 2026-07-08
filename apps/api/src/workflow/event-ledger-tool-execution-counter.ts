import { Injectable } from '@nestjs/common';
import { EventLedgerService } from '../observability/event-ledger.service';
import type { IToolExecutionCounter } from './tool-execution-counter.types';

const TOOL_DOMAIN = 'tool';
const TOOL_EXECUTION_COMPLETED_EVENT = 'tool.execution.completed';
const SUCCESS_OUTCOME = 'success';

/**
 * Counts successful tool executions for a job by querying the append-only event
 * ledger. A successful runtime tool call is recorded as a
 * `tool.execution.completed` event with `outcome: 'success'` scoped to the
 * workflow run and job.
 */
@Injectable()
export class EventLedgerToolExecutionCounter implements IToolExecutionCounter {
  constructor(private readonly eventLedger: EventLedgerService) {}

  async countSuccessfulToolExecutions(params: {
    workflowRunId: string;
    jobId: string;
    toolName: string;
  }): Promise<number> {
    const { total } = await this.eventLedger.query({
      domain: TOOL_DOMAIN,
      eventName: TOOL_EXECUTION_COMPLETED_EVENT,
      outcome: SUCCESS_OUTCOME,
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      toolName: params.toolName,
      // Only the total count is needed; avoid materialising the full page.
      limit: 1,
    });
    return total;
  }
}
