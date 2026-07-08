import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SatisfiedChild } from '@nexus/core';
import {
  CHAT_SESSION_DOMAIN_PORT,
  type ChatSessionDomainPort,
} from '../domain-ports';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { AgentAwaitEntity } from './agent-await.entity';
import { AgentAwaitRepository } from './agent-await.repository';
import { WorkflowJobMessageQueueService } from '../workflow-job-message-queue.service';
import { StepEventPublisherService } from '../workflow-step-execution/step-event-publisher.service';

const STATUS_RESUMING = 'RESUMING' as const;
const STATUS_RESUMED = 'RESUMED' as const;
const EVENT_RESUME_STARTED = 'agent_await.resume_started';
const EVENT_RESUMED = 'agent_await.resumed';
const EVENT_FAILED = 'agent_await.failed';
const RESULT_SUMMARY_MAX_LENGTH = 280;

/**
 * Resumes a parent agent step that was durably parked while awaiting one or
 * more child workflow runs, then re-enqueues the parent run with a join summary
 * so a fresh container continues execution.
 *
 * Resume works through either engine vehicle: a PI session tree (child outcomes
 * are injected as tree nodes and the prior session is rehydrated from it) or an
 * engine session ref (e.g. Claude Code, resumed via `options.resume` with child
 * outcomes carried in the join message). Only an await that has neither is
 * unrecoverable.
 *
 * Domain-neutral: deals only in run, step, and session identifiers.
 */
@Injectable()
export class DependencyParentResumeService {
  private readonly logger = new Logger(DependencyParentResumeService.name);

  constructor(
    private readonly awaitRepo: AgentAwaitRepository,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    @Inject(CHAT_SESSION_DOMAIN_PORT)
    private readonly sessionHydration: ChatSessionDomainPort,
    private readonly jobQueue: WorkflowJobMessageQueueService,
    private readonly eventPublisher: StepEventPublisherService,
  ) {}

  /**
   * Drives the resume for a fully-satisfied await that has already been
   * atomically promoted to `RESUMING`.
   *
   * On a successful re-enqueue the await is promoted to `RESUMED`. If the
   * re-enqueue fails the await is left in `RESUMING` (so the reconciler retries)
   * and the error is rethrown.
   *
   * @throws Error when the await has neither a session tree nor a session ref;
   * such a parked agent cannot be rehydrated and is a real, unrecoverable
   * failure.
   */
  async resumeParent(awaitRecord: AgentAwaitEntity): Promise<void> {
    // Re-resolve the freshest session tree at resume time. A run can accumulate
    // multiple trees across turns or distillation; the stored id was captured at
    // suspend time via findOne with no ordering and may be stale. Prefer the
    // freshly-resolved tree (ordered by updated_at/created_at DESC); fall back
    // to the stored id when the lookup returns nothing.
    const freshTree =
      await this.sessionHydration.findSessionTreeByWorkflowRunId(
        awaitRecord.parent_run_id,
      );
    const sessionTreeId =
      freshTree?.id ?? awaitRecord.parent_session_tree_id ?? null;
    const sessionRef = awaitRecord.parent_session_ref ?? null;

    // A parked parent is resumable through either engine vehicle: a PI session
    // tree (file-injected on rehydration) or an engine session ref (e.g. Claude
    // Code, resumed via `options.resume`). Only when neither exists is the
    // parent genuinely unrecoverable.
    if (!sessionTreeId && !sessionRef) {
      await this.eventPublisher.publishProcessEvent(
        awaitRecord.parent_run_id,
        EVENT_FAILED,
        {
          awaitId: awaitRecord.id,
          reason: 'missing_resume_handle',
        },
      );
      throw new Error(
        `Agent await ${awaitRecord.id} has no resumable session handle ` +
          `(neither a parent session tree nor a session ref) — the parked ` +
          `parent run ${awaitRecord.parent_run_id} cannot be resumed.`,
      );
    }

    await this.eventPublisher.publishProcessEvent(
      awaitRecord.parent_run_id,
      EVENT_RESUME_STARTED,
      {
        awaitId: awaitRecord.id,
        satisfiedRunIds: awaitRecord.satisfied_run_ids.map(
          (child) => child.runId,
        ),
      },
    );

    const childContents: string[] = [];
    for (const child of awaitRecord.satisfied_run_ids) {
      const content = await this.buildChildResultNodeContent(child);
      childContents.push(content);
      // PI rehydration replays the session tree, so child outcomes are injected
      // as tree nodes. A tree-less engine (e.g. Claude Code) has no tree to
      // append to; its outcomes are carried in the join message instead.
      if (sessionTreeId) {
        await this.sessionHydration.appendSystemResultNode(
          sessionTreeId,
          content,
        );
      }
    }

    const joinMessage = this.buildJoinMessage(
      awaitRecord.satisfied_run_ids,
      sessionTreeId ? undefined : childContents,
    );

    await this.runRepo.clearWaitState(awaitRecord.parent_run_id);

    await this.jobQueue.resumeJobWithMessage(
      awaitRecord.parent_run_id,
      sessionTreeId ?? undefined,
      joinMessage,
      sessionRef ? { resumeSessionRef: sessionRef } : undefined,
    );

    await this.awaitRepo.compareAndSetStatus(
      awaitRecord.id,
      STATUS_RESUMING,
      STATUS_RESUMED,
    );

    await this.eventPublisher.publishProcessEvent(
      awaitRecord.parent_run_id,
      EVENT_RESUMED,
      {
        awaitId: awaitRecord.id,
        sessionTreeId,
      },
    );

    this.logger.log(
      `Resumed parent run ${awaitRecord.parent_run_id} on dependency join ` +
        `for await ${awaitRecord.id}`,
    );
  }

  private async buildChildResultNodeContent(
    child: SatisfiedChild,
  ): Promise<string> {
    const detail = await this.resolveChildResultDetail(child.runId);
    const suffix = detail ? ` Result: ${detail}` : '';
    return (
      `Awaited workflow ${child.runId} finished with status ${child.status}.` +
      suffix
    );
  }

  private async resolveChildResultDetail(
    childRunId: string,
  ): Promise<string | null> {
    const run = await this.runRepo.findById(childRunId);
    const stateVariables = run?.state_variables;
    if (!stateVariables || Object.keys(stateVariables).length === 0) {
      return null;
    }

    const summary = JSON.stringify(stateVariables);
    if (summary.length <= RESULT_SUMMARY_MAX_LENGTH) {
      return summary;
    }

    return `${summary.slice(0, RESULT_SUMMARY_MAX_LENGTH)}…`;
  }

  /**
   * Builds the user message that re-enters the resumed parent step. When
   * `inlinedResults` is supplied (tree-less engines such as Claude Code, where
   * outcomes cannot be injected as session-tree nodes) each child's full result
   * detail is embedded directly in the message so the agent still receives it.
   */
  private buildJoinMessage(
    satisfiedChildren: SatisfiedChild[],
    inlinedResults?: string[],
  ): string {
    const outcomes = satisfiedChildren
      .map((child) => `${child.runId} ${child.status}`)
      .join(', ');
    const header = `Your awaited workflows finished: ${outcomes}. `;

    if (inlinedResults && inlinedResults.length > 0) {
      return `${header}Their results:\n${inlinedResults.join('\n')}\nContinue.`;
    }

    return `${header}Their results have been added to your context. Continue.`;
  }
}
