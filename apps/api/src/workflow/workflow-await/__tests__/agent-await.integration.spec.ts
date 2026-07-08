import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentAwaitStatus,
  SatisfiedChild,
  WaitReason,
  WorkflowStatus,
} from '@nexus/core';
import { AgentAwaitEntity } from '../agent-await.entity';
import { AgentAwaitRepository } from '../agent-await.repository';
import { AgentAwaitRegistryService } from '../agent-await-registry.service';
import { DependencyParentResumeService } from '../dependency-parent-resume.service';
import { AgentAwaitChildTerminalListener } from '../agent-await-child-terminal.listener';
import type { IWorkflowRunRepository } from '../../kernel/interfaces/workflow-kernel.ports';
import { WorkflowRun } from '../../database/entities/workflow-run.entity';
import { ChatSessionDomainPort } from '../../domain-ports';
import { WorkflowJobMessageQueueService } from '../../workflow-job-message-queue.service';
import { StepEventPublisherService } from '../../workflow-step-execution/step-event-publisher.service';
import type { CreateAgentAwaitInput } from '../agent-await.types';
import type { WorkflowRunEvent } from '../../workflow-events.types';

/**
 * Integration proof of the durable agent-await join flow (SDD §4.6).
 *
 * The two persistence boundaries — {@link AgentAwaitRepository} and
 * {@link IWorkflowRunRepository} — are replaced with in-memory fakes that
 * faithfully reproduce the exact query semantics the production code relies on
 * (JSONB containment lookup, satisfied-child dedupe, atomic compare-and-set
 * status transitions, and "set wait state only while RUNNING"). Every other
 * collaborator is the real service wired via plain constructor injection, so
 * the test exercises the genuine join math and CAS idempotency rather than
 * mock theater. Only the true infra edges — session hydration and the job
 * queue — are stubbed as spies.
 */

const RUNNING: WorkflowStatus = 'RUNNING';
const COMPLETED: WorkflowStatus = 'COMPLETED';
const STATUS_WAITING: AgentAwaitStatus = 'WAITING';
const STATUS_RESUMED: AgentAwaitStatus = 'RESUMED';
const DEPENDENCY: WaitReason = 'dependency';

const PARENT_RUN_ID = 'parent-run-P';
const CHILD_RUN_ID_1 = 'child-run-C1';
const CHILD_RUN_ID_2 = 'child-run-C2';
const PARENT_STEP_ID = 'parent-step-1';
const PARENT_SESSION_TREE_ID = 'session-tree-P';

/**
 * In-memory {@link AgentAwaitRepository} that implements only the methods used
 * by the join flow, mirroring the real Postgres/TypeORM semantics.
 */
class FakeAgentAwaitRepository {
  private readonly rows = new Map<string, AgentAwaitEntity>();
  private sequence = 0;

  async create(input: CreateAgentAwaitInput): Promise<AgentAwaitEntity> {
    this.sequence += 1;
    const now = new Date('2026-06-12T00:00:00.000Z');
    const entity: AgentAwaitEntity = {
      id: `await-${this.sequence}`,
      parent_run_id: input.parentRunId,
      parent_step_id: input.parentStepId,
      parent_session_tree_id: input.parentSessionTreeId ?? null,
      awaited_run_ids: [...input.awaitedRunIds],
      satisfied_run_ids: [],
      status: STATUS_WAITING,
      resume_node_id: input.resumeNodeId ?? null,
      created_at: now,
      updated_at: now,
    };
    this.rows.set(entity.id, entity);
    return this.clone(entity);
  }

  async findById(id: string): Promise<AgentAwaitEntity | null> {
    const row = this.rows.get(id);
    return row ? this.clone(row) : null;
  }

  /**
   * Mirrors the production `await.awaited_run_ids @> [childRunId]` JSONB
   * containment query, restricted to WAITING awaits.
   */
  async findWaitingByAwaitedChild(
    childRunId: string,
  ): Promise<AgentAwaitEntity[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.status === STATUS_WAITING &&
          row.awaited_run_ids.includes(childRunId),
      )
      .map((row) => this.clone(row));
  }

  /** Idempotent read-modify-write: dedupes by child runId. */
  async markSatisfied(id: string, child: SatisfiedChild): Promise<void> {
    const row = this.rows.get(id);
    if (!row) {
      return;
    }
    const alreadySatisfied = row.satisfied_run_ids.some(
      (satisfied) => satisfied.runId === child.runId,
    );
    if (alreadySatisfied) {
      return;
    }
    row.satisfied_run_ids = [...row.satisfied_run_ids, { ...child }];
  }

  /** Atomic transition: succeeds iff the row is currently in `from`. */
  async compareAndSetStatus(
    id: string,
    from: AgentAwaitStatus,
    to: AgentAwaitStatus,
  ): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== from) {
      return false;
    }
    row.status = to;
    return true;
  }

  /** Cancels every non-terminal await parked on the given parent run. */
  async cancelOpenForParentRun(parentRunId: string): Promise<number> {
    let affected = 0;
    for (const row of this.rows.values()) {
      if (
        row.parent_run_id === parentRunId &&
        (row.status === 'WAITING' || row.status === 'RESUMING')
      ) {
        row.status = 'CANCELLED';
        affected += 1;
      }
    }
    return affected;
  }

  private clone(entity: AgentAwaitEntity): AgentAwaitEntity {
    return {
      ...entity,
      awaited_run_ids: [...entity.awaited_run_ids],
      satisfied_run_ids: entity.satisfied_run_ids.map((child) => ({
        ...child,
      })),
    };
  }
}

/**
 * In-memory {@link IWorkflowRunRepository} covering only the wait-state surface
 * the join flow touches. `setWaitState` mirrors the production guard that only
 * parks a run while it is RUNNING.
 */
class FakeWorkflowRunRepository {
  private readonly rows = new Map<string, WorkflowRun>();

  seed(run: Pick<WorkflowRun, 'id' | 'status'> & Partial<WorkflowRun>): void {
    const entity = {
      workflow_id: 'workflow-1',
      state_variables: {},
      awaiting_input: false,
      wait_reason: null,
      created_at: new Date('2026-06-12T00:00:00.000Z'),
      updated_at: new Date('2026-06-12T00:00:00.000Z'),
      ...run,
    } as WorkflowRun;
    this.rows.set(entity.id, entity);
  }

  async findById(id: string): Promise<WorkflowRun | null> {
    return this.rows.get(id) ?? null;
  }

  /** Parks a run on a wait reason — only while it is RUNNING (production guard). */
  async setWaitState(runId: string, reason: WaitReason): Promise<void> {
    const row = this.rows.get(runId);
    if (!row || row.status !== RUNNING) {
      return;
    }
    row.wait_reason = reason;
  }

  async clearWaitState(runId: string): Promise<void> {
    const row = this.rows.get(runId);
    if (!row) {
      return;
    }
    row.wait_reason = null;
    row.awaiting_input = false;
  }
}

const runEvent = (workflowRunId: string): WorkflowRunEvent => ({
  workflowRunId,
  workflowId: 'workflow-1',
  status: COMPLETED,
  stateVariables: {},
});

describe('Durable agent await — join flow (integration)', () => {
  let awaitRepo: FakeAgentAwaitRepository;
  let runRepo: FakeWorkflowRunRepository;
  let sessionHydration: {
    appendSystemResultNode: ReturnType<typeof vi.fn>;
    findSessionTreeByWorkflowRunId: ReturnType<typeof vi.fn>;
  };
  let jobQueue: { resumeJobWithMessage: ReturnType<typeof vi.fn> };
  let publisher: { publishProcessEvent: ReturnType<typeof vi.fn> };

  let registry: AgentAwaitRegistryService;
  let parentResume: DependencyParentResumeService;
  let listener: AgentAwaitChildTerminalListener;

  beforeEach(() => {
    awaitRepo = new FakeAgentAwaitRepository();
    runRepo = new FakeWorkflowRunRepository();
    runRepo.seed({ id: PARENT_RUN_ID, status: RUNNING });

    sessionHydration = {
      appendSystemResultNode: vi.fn().mockResolvedValue('node-id'),
      findSessionTreeByWorkflowRunId: vi.fn().mockResolvedValue(null),
    };
    jobQueue = {
      resumeJobWithMessage: vi.fn().mockResolvedValue('job-1'),
    };
    publisher = {
      publishProcessEvent: vi.fn().mockResolvedValue(undefined),
    };

    registry = new AgentAwaitRegistryService(
      awaitRepo as unknown as AgentAwaitRepository,
      runRepo as unknown as IWorkflowRunRepository,
      publisher as unknown as StepEventPublisherService,
    );
    parentResume = new DependencyParentResumeService(
      awaitRepo as unknown as AgentAwaitRepository,
      runRepo as unknown as IWorkflowRunRepository,
      sessionHydration as unknown as ChatSessionDomainPort,
      jobQueue as unknown as WorkflowJobMessageQueueService,
      publisher as unknown as StepEventPublisherService,
    );
    listener = new AgentAwaitChildTerminalListener(
      registry,
      parentResume,
      awaitRepo as unknown as AgentAwaitRepository,
    );
  });

  it('parks the parent until ALL children are terminal, then resumes exactly once (idempotent)', async () => {
    // ── Step 1: register await P → [C1, C2]; parent gets parked on dependency ──
    await registry.register({
      parentRunId: PARENT_RUN_ID,
      parentStepId: PARENT_STEP_ID,
      parentSessionTreeId: PARENT_SESSION_TREE_ID,
      awaitedRunIds: [CHILD_RUN_ID_1, CHILD_RUN_ID_2],
    });

    const parkedRun = await runRepo.findById(PARENT_RUN_ID);
    expect(parkedRun?.wait_reason).toBe(DEPENDENCY);

    // ── Step 2: C1 completes — partial satisfaction, parent stays parked ──
    await listener.handleRunCompleted(runEvent(CHILD_RUN_ID_1));

    expect(jobQueue.resumeJobWithMessage).not.toHaveBeenCalled();
    const stillParked = await runRepo.findById(PARENT_RUN_ID);
    expect(stillParked?.wait_reason).toBe(DEPENDENCY);

    // ── Step 3: C2 fails — join completes and the parent resumes ──
    await listener.handleRunFailed(runEvent(CHILD_RUN_ID_2));

    // One system result node per satisfied child (C1 COMPLETED, C2 FAILED).
    expect(sessionHydration.appendSystemResultNode).toHaveBeenCalledTimes(2);
    const appendedContents =
      sessionHydration.appendSystemResultNode.mock.calls.map(
        (call) => call[1] as string,
      );
    expect(appendedContents.some((c) => c.includes('COMPLETED'))).toBe(true);
    expect(appendedContents.some((c) => c.includes('FAILED'))).toBe(true);
    expect(appendedContents.some((c) => c.includes(CHILD_RUN_ID_1))).toBe(true);
    expect(appendedContents.some((c) => c.includes(CHILD_RUN_ID_2))).toBe(true);

    // Parent wait state cleared.
    const unparked = await runRepo.findById(PARENT_RUN_ID);
    expect(unparked?.wait_reason).toBeNull();

    // Resume enqueued exactly once with the parent session tree.
    expect(jobQueue.resumeJobWithMessage).toHaveBeenCalledTimes(1);
    const [resumedRunId, resumedTreeId, resumedMessage] = jobQueue
      .resumeJobWithMessage.mock.calls[0] as [string, string, string];
    expect(resumedRunId).toBe(PARENT_RUN_ID);
    expect(resumedTreeId).toBe(PARENT_SESSION_TREE_ID);
    expect(resumedMessage).toContain(CHILD_RUN_ID_1);
    expect(resumedMessage).toContain(CHILD_RUN_ID_2);

    // Await record promoted to RESUMED.
    const waitingMatches =
      await awaitRepo.findWaitingByAwaitedChild(CHILD_RUN_ID_2);
    expect(waitingMatches).toHaveLength(0);
    const resumedAwait = await awaitRepo.findById('await-1');
    expect(resumedAwait?.status).toBe(STATUS_RESUMED);

    // ── Step 4: idempotency — re-deliver C2 terminal; CAS guard blocks replay ──
    await listener.handleRunFailed(runEvent(CHILD_RUN_ID_2));

    expect(jobQueue.resumeJobWithMessage).toHaveBeenCalledTimes(1);
    expect(sessionHydration.appendSystemResultNode).toHaveBeenCalledTimes(2);
    const afterReplay = await awaitRepo.findById('await-1');
    expect(afterReplay?.status).toBe(STATUS_RESUMED);
  });

  it('cancels every await parked on a run that is itself cancelled (no resurrection)', async () => {
    // Parent P is parked awaiting C1 + C2.
    await registry.register({
      parentRunId: PARENT_RUN_ID,
      parentStepId: PARENT_STEP_ID,
      parentSessionTreeId: PARENT_SESSION_TREE_ID,
      awaitedRunIds: [CHILD_RUN_ID_1, CHILD_RUN_ID_2],
    });

    // The user aborts the parent run; the engine emits run.cancelled for P.
    await listener.handleRunCancelled(runEvent(PARENT_RUN_ID));

    // The parked await is terminal, so the reconciler/listener can never
    // re-select it to resume the cancelled parent.
    const parkedAwait = await awaitRepo.findById('await-1');
    expect(parkedAwait?.status).toBe('CANCELLED');

    // A later child-terminal signal must NOT resume the cancelled parent.
    await listener.handleRunCompleted(runEvent(CHILD_RUN_ID_1));
    await listener.handleRunFailed(runEvent(CHILD_RUN_ID_2));
    expect(jobQueue.resumeJobWithMessage).not.toHaveBeenCalled();
  });

  it('does not resume when an unrelated child reaches terminal', async () => {
    await registry.register({
      parentRunId: PARENT_RUN_ID,
      parentStepId: PARENT_STEP_ID,
      parentSessionTreeId: PARENT_SESSION_TREE_ID,
      awaitedRunIds: [CHILD_RUN_ID_1, CHILD_RUN_ID_2],
    });

    await listener.handleRunCompleted(runEvent('unrelated-run'));

    expect(jobQueue.resumeJobWithMessage).not.toHaveBeenCalled();
    const stillParked = await runRepo.findById(PARENT_RUN_ID);
    expect(stillParked?.wait_reason).toBe(DEPENDENCY);
  });
});

/**
 * The completion guard ("a parked run with a wait_reason set does not complete")
 * is proven by the dedicated Task 11 unit test for
 * `WorkflowRunJobExecutionService.handleJobComplete`; wiring the full job
 * execution service (queues, container runtime, retry policy) into this
 * integration test would add heavy, low-signal scaffolding. This suite instead
 * focuses on proving the join flow (steps 1–4) robustly with real services.
 *
 * @see workflow-run-job-execution.service.spec.ts — completion guard unit test
 */
