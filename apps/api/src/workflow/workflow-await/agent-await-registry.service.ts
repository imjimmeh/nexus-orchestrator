import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { AgentAwaitStatus, SatisfiedChild, WaitReason } from '@nexus/core';
import { AgentAwaitEntity } from './agent-await.entity';
import { AgentAwaitRepository } from './agent-await.repository';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { StepEventPublisherService } from '../workflow-step-execution/step-event-publisher.service';
import type {
  ChildTerminalResult,
  RegisterAgentAwaitInput,
} from './agent-await-registry.service.types';

const DEPENDENCY_WAIT_REASON: WaitReason = 'dependency';
const STATUS_WAITING: AgentAwaitStatus = 'WAITING';
const STATUS_RESUMING: AgentAwaitStatus = 'RESUMING';
const EVENT_REGISTERED = 'agent_await.registered';
const EVENT_CHILD_SATISFIED = 'agent_await.child_satisfied';

/**
 * The join brain for durable agent awaits: it opens await records, parks the
 * parent run on a dependency wait, and — as awaited children reach terminal
 * states — marks them satisfied and atomically promotes a fully-satisfied
 * await to `RESUMING` so the run can be resumed.
 *
 * Domain-neutral: deals only in run, step, and session identifiers.
 */
@Injectable()
export class AgentAwaitRegistryService {
  constructor(
    private readonly awaitRepo: AgentAwaitRepository,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly eventPublisher: StepEventPublisherService,
  ) {}

  /**
   * Opens a durable await record for a parent step suspended on one or more
   * child runs and parks the parent run on a `dependency` wait.
   *
   * @throws BadRequestException when `awaitedRunIds` is empty, or when the
   * parent run awaits itself (a trivial cycle / self-await).
   */
  async register(input: RegisterAgentAwaitInput): Promise<AgentAwaitEntity> {
    if (input.awaitedRunIds.length === 0) {
      throw new BadRequestException(
        'Cannot register an agent await with no awaited run ids.',
      );
    }

    if (input.awaitedRunIds.includes(input.parentRunId)) {
      throw new BadRequestException(
        `Agent await for run ${input.parentRunId} cannot await itself.`,
      );
    }

    const created = await this.awaitRepo.create({
      parentRunId: input.parentRunId,
      parentStepId: input.parentStepId,
      parentSessionTreeId: input.parentSessionTreeId ?? null,
      awaitedRunIds: input.awaitedRunIds,
      resumeNodeId: input.resumeNodeId ?? null,
    });

    await this.runRepo.setWaitState(input.parentRunId, DEPENDENCY_WAIT_REASON);

    await this.eventPublisher.publishProcessEvent(
      input.parentRunId,
      EVENT_REGISTERED,
      {
        awaitId: created.id,
        stepId: created.parent_step_id,
        awaitedRunIds: created.awaited_run_ids,
        resumeNodeId: created.resume_node_id,
      },
    );

    return created;
  }

  /**
   * Notifies the registry that a child run reached a terminal state. Every
   * WAITING await depending on the child is marked satisfied; the first await
   * that becomes fully satisfied AND wins the atomic transition to `RESUMING`
   * is returned as `ready`.
   *
   * If several awaits become ready in one call, only the first winner is
   * returned here; the remaining ready awaits stay in `RESUMING` and are picked
   * up by the reconciler/listener. Unknown children and lost CAS races are
   * no-ops that return `{ ready: null }`.
   */
  async onChildTerminal(
    childRunId: string,
    status: SatisfiedChild['status'],
  ): Promise<ChildTerminalResult> {
    const waiting = await this.awaitRepo.findWaitingByAwaitedChild(childRunId);
    if (waiting.length === 0) {
      return { ready: null };
    }

    const child: SatisfiedChild = { runId: childRunId, status };
    let ready: AgentAwaitEntity | null = null;

    for (const candidate of waiting) {
      await this.satisfyChild(candidate.id, child);

      if (ready !== null) {
        // A winner has already been found; keep marking the remaining awaits
        // satisfied but defer their promotion to the reconciler.
        continue;
      }

      const refreshed = await this.awaitRepo.findById(candidate.id);
      if (refreshed === null || !this.isFullySatisfied(refreshed)) {
        continue;
      }

      const won = await this.awaitRepo.compareAndSetStatus(
        refreshed.id,
        STATUS_WAITING,
        STATUS_RESUMING,
      );
      if (won) {
        ready = refreshed;
      }
    }

    return { ready };
  }

  private async satisfyChild(
    awaitId: string,
    child: SatisfiedChild,
  ): Promise<void> {
    await this.awaitRepo.markSatisfied(awaitId, child);

    const refreshed = await this.awaitRepo.findById(awaitId);
    const parentRunId = refreshed?.parent_run_id;
    if (parentRunId === undefined) {
      return;
    }

    await this.eventPublisher.publishProcessEvent(
      parentRunId,
      EVENT_CHILD_SATISFIED,
      {
        awaitId,
        childRunId: child.runId,
        status: child.status,
      },
    );
  }

  private isFullySatisfied(entity: AgentAwaitEntity): boolean {
    const satisfiedIds = new Set(
      entity.satisfied_run_ids.map((satisfied) => satisfied.runId),
    );
    return entity.awaited_run_ids.every((runId) => satisfiedIds.has(runId));
  }
}
