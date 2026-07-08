import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
} from '../workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow-events.types';
import { RetrospectiveEnqueueService } from './retrospective-enqueue.service';

const TERMINAL_STATUS_COMPLETED = 'completed';
const TERMINAL_STATUS_FAILED = 'failed';

/**
 * `RetrospectiveEnqueueListener` — listens to terminal workflow runs and enqueues them via RetrospectiveEnqueueService.
 */
@Injectable()
export class RetrospectiveEnqueueListener {
  constructor(private readonly enqueueService: RetrospectiveEnqueueService) {}

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async handleWorkflowRunCompleted(event: WorkflowRunEvent): Promise<void> {
    await this.enqueueService.enqueueWorkflowRun(
      event,
      TERMINAL_STATUS_COMPLETED,
    );
  }

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async handleWorkflowRunFailed(event: WorkflowRunEvent): Promise<void> {
    await this.enqueueService.enqueueWorkflowRun(event, TERMINAL_STATUS_FAILED);
  }
}
