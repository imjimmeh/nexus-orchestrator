import { Injectable, Logger } from '@nestjs/common';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import { ExecutionEventPublisher } from '../../execution-lifecycle/execution-event.publisher';

interface FinalizeFromAgentEndParams {
  workflowRunId: string;
  contextId: string;
  hasFailure: boolean;
  failureMessage?: string;
}

interface FinalizeResult {
  finalized: boolean;
  executionId?: string;
}

/**
 * Provides a durable, idempotent path to emit `execution.completed` or
 * `execution.failed` for a workflow step driven by a WebSocket `agent_end`
 * event. When the in-process awaiter already finalized the step (no running
 * row found), this service is a no-op — ensuring exactly-once semantics
 * without any additional locking.
 */
@Injectable()
export class StepCompletionFinalizerService {
  private readonly logger = new Logger(StepCompletionFinalizerService.name);

  constructor(
    private readonly executionRepo: ExecutionRepository,
    private readonly publisher: ExecutionEventPublisher,
  ) {}

  async finalizeFromAgentEnd(
    params: FinalizeFromAgentEndParams,
  ): Promise<FinalizeResult> {
    const { workflowRunId, contextId, hasFailure, failureMessage } = params;

    const row = await this.executionRepo.findRunningStepByRunAndContext(
      workflowRunId,
      contextId,
    );

    if (row === null) {
      this.logger.debug(
        `No running step found for run=${workflowRunId} context=${contextId}; skipping finalization (already finalized)`,
      );
      return { finalized: false };
    }

    if (hasFailure) {
      await this.publisher.failed(row.id, {
        failure_reason: 'agent_error',
        error_message: failureMessage,
      });
    } else {
      await this.publisher.completed(row.id);
    }

    this.logger.debug(
      `Finalized execution ${row.id} (hasFailure=${String(hasFailure)}) for run=${workflowRunId} context=${contextId}`,
    );

    return { finalized: true, executionId: row.id };
  }
}
