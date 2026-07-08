import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
  WORKFLOW_RUN_CANCELLED_EVENT,
} from '../workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow-events.types';
import { WebAutomationSessionStoreService } from '../../web-automation/web-automation-session-store.service';

@Injectable()
export class WorkflowRunBrowserSessionCleanupListener {
  constructor(
    private readonly sessionStore: WebAutomationSessionStoreService,
  ) {}

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  @OnEvent(WORKFLOW_RUN_CANCELLED_EVENT)
  async handleWorkflowRunTerminated(payload: WorkflowRunEvent): Promise<void> {
    await this.sessionStore.closeRunSessions(payload.workflowRunId);
  }
}
