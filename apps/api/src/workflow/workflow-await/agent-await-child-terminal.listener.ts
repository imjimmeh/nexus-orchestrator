import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { SatisfiedChild } from '@nexus/core';
import {
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
  WORKFLOW_RUN_CANCELLED_EVENT,
} from '../workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow-events.types';
import { AgentAwaitRegistryService } from './agent-await-registry.service';
import { AgentAwaitRepository } from './agent-await.repository';
import { DependencyParentResumeService } from './dependency-parent-resume.service';

type ChildTerminalStatus = SatisfiedChild['status'];

/**
 * Closes the upward child → parent edge of the durable agent await graph.
 *
 * When a (child) workflow run reaches a terminal state, the canonical
 * `workflow.run.{completed,failed,cancelled}` lifecycle events fire. This
 * listener forwards that terminal signal to the await registry; if a parked
 * parent await becomes fully satisfied and is atomically promoted to
 * `RESUMING`, it drives the resume.
 *
 * Failures here are swallowed and logged rather than rethrown: a resume that
 * cannot complete now must be retried by the reconciler later, not crash the
 * event pipeline (which would also break unrelated terminal-event listeners).
 *
 * Domain-neutral: deals only in run identifiers and terminal statuses.
 */
@Injectable()
export class AgentAwaitChildTerminalListener {
  private readonly logger = new Logger(AgentAwaitChildTerminalListener.name);

  constructor(
    private readonly registry: AgentAwaitRegistryService,
    private readonly parentResume: DependencyParentResumeService,
    private readonly awaitRepo: AgentAwaitRepository,
  ) {}

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async handleRunCompleted(payload: WorkflowRunEvent): Promise<void> {
    await this.notifyChildTerminal(payload.workflowRunId, 'COMPLETED');
  }

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async handleRunFailed(payload: WorkflowRunEvent): Promise<void> {
    await this.notifyChildTerminal(payload.workflowRunId, 'FAILED');
  }

  @OnEvent(WORKFLOW_RUN_CANCELLED_EVENT)
  async handleRunCancelled(payload: WorkflowRunEvent): Promise<void> {
    // A cancelled run plays two roles in the await graph. As a child it
    // satisfies parents awaiting it (downward edge). As a parent it must also
    // have its own parked awaits cancelled — otherwise the reconciler or a
    // later child-terminal event resumes the run via `resumeJobWithMessage`,
    // resurrecting a run the user just aborted.
    await this.cancelParentAwaits(payload.workflowRunId);
    await this.notifyChildTerminal(payload.workflowRunId, 'CANCELLED');
  }

  private async cancelParentAwaits(parentRunId: string): Promise<void> {
    try {
      const cancelled =
        await this.awaitRepo.cancelOpenForParentRun(parentRunId);
      if (cancelled > 0) {
        this.logger.log(
          `Cancelled ${cancelled.toString()} parked await(s) for cancelled ` +
            `run ${parentRunId}.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to cancel parked awaits for cancelled run ${parentRunId}: ` +
          message,
      );
    }
  }

  private async notifyChildTerminal(
    childRunId: string,
    status: ChildTerminalStatus,
  ): Promise<void> {
    try {
      const { ready } = await this.registry.onChildTerminal(childRunId, status);
      if (ready) {
        await this.parentResume.resumeParent(ready);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to resume parent await for terminal child run ${childRunId} ` +
          `(${status}): ${message}. The reconciler will retry.`,
      );
    }
  }
}
