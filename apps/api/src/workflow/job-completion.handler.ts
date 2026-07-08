import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IJob, IWorkflowDefinition, WorkflowStatus } from '@nexus/core';
import type { WorkflowRun } from './database/entities/workflow-run.entity';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import { WorkflowRunQuestionParkService } from './workflow-run-question-park.service';
import { DAGResolverService } from './dag-resolver.service';
import { StateMachineService } from './state-machine.service';
import { StateManagerService } from './state-manager.service';
import {
  WORKFLOW_JOB_COMPLETED_EVENT,
  WORKFLOW_RUN_COMPLETED_EVENT,
} from './workflow-events.constants';
import type {
  WorkflowJobEvent,
  WorkflowRunEvent,
} from './workflow-events.types';
import {
  areAllJobsCompleted,
  areDependenciesCompleted,
  findJobLevel,
  resolveTransitionTarget,
  enqueueTransitionJob,
} from './workflow-run-job-execution.utils';
import { MaxLoopIterationsExceededError } from './workflow-loop-guard.errors';
import { clearAutoRetryState } from './workflow-run-retry-state.helpers';
import { markJobCompleted, markJobSkipped } from './workflow-job-state.utils';
import { buildJobCompletedPayload } from './workflow-job-completion-payload.util';
import { skipStrictJobWhenDependencyResultsBlock } from './workflow-run-job-skip.utils';
import { buildRunStatusTimestampPatch } from './workflow-run-status-timestamps.helper';
import type { JobCompletionHandlerDeps } from './job-completion.handler.types';

export type { JobCompletionHandlerDeps } from './job-completion.handler.types';

/**
 * Owns the success-path terminal-write logic for workflow runs.
 *
 * Originally lived inline in `WorkflowRunJobExecutionService.handleJobComplete`
 * as a 115+ LOC method with deeply nested control flow. Extracted here so the
 * public service stays a thin orchestrator and the completion hot path becomes
 * a small, named, testable surface.
 *
 * Behavior is preserved byte-for-byte against the original implementation.
 */
@Injectable()
export class JobCompletionHandler {
  private readonly logger = new Logger(JobCompletionHandler.name);

  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly questionPark: WorkflowRunQuestionParkService,
    private readonly stateManager: StateManagerService,
    private readonly eventEmitter: EventEmitter2,
    private readonly stateMachine: StateMachineService,
    private readonly dagResolver: DAGResolverService,
  ) {}

  async handle(
    workflowRunId: string,
    jobId: string,
    output: Record<string, unknown>,
    deps: JobCompletionHandlerDeps,
  ): Promise<void> {
    const run = await this.gateCompletion(workflowRunId, jobId);
    if (!run) {
      return;
    }

    const def = await deps.loadWorkflowDefinition(run.workflow_id);
    const job = def.jobs?.find((candidate) => candidate.id === jobId);
    if (!job) {
      this.logger.error(
        `Job ${jobId} not found in workflow ${run.workflow_id}`,
      );
      return;
    }

    await this.recordJobCompletion(workflowRunId, run, jobId, output);
    await this.dispatchNext(workflowRunId, jobId, job, def, deps);
  }

  /**
   * Applies the four guard clauses that must hold before a terminal-write
   * trigger advances the workflow: the run still exists, the run is RUNNING,
   * a parked run has not intentionally suspended this turn, and the atomic
   * compare-and-set has not already been claimed by a duplicate trigger.
   *
   * Returns the loaded run on success, or `null` when any guard fails (and
   * the appropriate diagnostic has already been logged).
   */
  private async gateCompletion(
    workflowRunId: string,
    jobId: string,
  ): Promise<WorkflowRun | null> {
    const run = await this.runRepo.findById(workflowRunId);
    if (!run) {
      return null;
    }

    if (run.status !== WorkflowStatus.RUNNING) {
      this.logger.warn(
        `Run ${workflowRunId} is not RUNNING, ignoring completion of ${jobId}`,
      );
      return null;
    }

    // A run parked on a durable dependency wait (await_agent_workflow) or on
    // an unanswered user question is intentionally suspended, not finished.
    // The question-park service decides: it suspends genuine parks, but
    // completes (clearing stale awaiting_input state) when a retried execution
    // finished the job and persisted output — otherwise that genuine
    // completion would be discarded and the run wedged RUNNING forever.
    if (
      (await this.questionPark.resolveParkedTurnEnd(run, jobId)) === 'suspend'
    ) {
      return null;
    }

    // The terminal-write router can be triggered more than once for the same
    // (run, job): synchronously at agent turn-end and asynchronously via the
    // execution.completed domain event when the container is torn down.
    // Without this atomic claim both triggers re-dispatch the successor chain,
    // racing duplicate jobs onto the same downstream lease. Only the first
    // claimant proceeds; a duplicate trigger returns before re-running
    // completion.
    if (!(await this.stateManager.tryMarkJobCompleted(workflowRunId, jobId))) {
      this.logger.debug(
        `Job ${jobId} in run ${workflowRunId} already completed; ignoring duplicate terminal-write trigger`,
      );
      return null;
    }

    return run;
  }

  /**
   * Persists the job's terminal state, clears any stale auto-retry marker
   * left over from a prior failed attempt, and emits the job-completed
   * domain event so listeners (audit, telemetry, etc.) see the same payload
   * as the original inline implementation.
   */
  private async recordJobCompletion(
    workflowRunId: string,
    run: WorkflowRun,
    jobId: string,
    output: Record<string, unknown>,
  ): Promise<void> {
    await markJobCompleted({
      workflowRunId,
      jobId,
      output,
      getVariable: (path) => this.stateManager.getVariable(workflowRunId, path),
      setVariable: (path, value) =>
        this.stateManager.setVariable(workflowRunId, path, value),
    });

    // The job succeeded, so any auto-retry state left over from a transient
    // failure on a prior attempt is now obsolete. Drop it so the UI shows no
    // stale "retry queued" banner and a later loop iteration starts with a
    // fresh retry budget.
    await clearAutoRetryState(this.stateManager, workflowRunId, jobId);

    this.eventEmitter.emit(WORKFLOW_JOB_COMPLETED_EVENT, {
      workflowRunId,
      workflowId: run.workflow_id,
      jobId,
      output,
      payload: buildJobCompletedPayload(output),
    } satisfies WorkflowJobEvent);
  }

  /**
   * Resolves the next job for the workflow — either an explicit transition
   * target (preferred), or the next DAG level when no transition is declared.
   * Routes loop-iteration failures back through `handleJobFailed` so retry
   * policy and failure semantics stay on the public service.
   */
  private async dispatchNext(
    workflowRunId: string,
    jobId: string,
    job: IJob,
    def: IWorkflowDefinition,
    deps: JobCompletionHandlerDeps,
  ): Promise<void> {
    const nextJobId = await this.resolveNextJobId(
      workflowRunId,
      job,
      jobId,
      deps,
    );
    if (nextJobId === undefined) {
      // Loop-iteration guard tripped; the failure path already owns further
      // handling, so the completion path exits cleanly.
      return;
    }

    if (nextJobId === null) {
      await this.progressDagOrComplete(workflowRunId, def, jobId, deps);
      return;
    }

    await enqueueTransitionJob({
      workflowRunId,
      def,
      jobId,
      nextJobId,
      stateManager: this.stateManager,
      runRepo: this.runRepo,
      enqueueJob: deps.enqueueJob,
      logger: this.logger,
    });
  }

  /**
   * Wraps `resolveTransitionTarget` so the loop-iteration error path stays
   * expressed in the handler instead of bubbling raw `Error` instances.
   *
   * Returns:
   * - `string`  → the next job id to enqueue via the transition path;
   * - `null`    → no transition target, the DAG progression path applies;
   * - `undefined` → loop-iteration guard tripped, the failure path already
   *                owns further handling.
   */
  private async resolveNextJobId(
    workflowRunId: string,
    job: IJob,
    jobId: string,
    deps: JobCompletionHandlerDeps,
  ): Promise<string | null | undefined> {
    try {
      return await resolveTransitionTarget({
        workflowRunId,
        job,
        jobId,
        runRepo: this.runRepo,
        stateMachine: this.stateMachine,
        stateManager: this.stateManager,
        logger: this.logger,
      });
    } catch (error) {
      if (!(error instanceof MaxLoopIterationsExceededError)) {
        throw error;
      }
      await deps.reportMaxLoopIterations(workflowRunId, jobId, error.message);
      return undefined;
    }
  }

  /**
   * Advances the DAG after a job completes when no explicit transition fires.
   * If every job is done, the run reaches its terminal COMPLETED state;
   * otherwise jobs at the next level(s) are enqueued when their dependencies
   * are satisfied and their conditions (if any) evaluate to true.
   */
  private async progressDagOrComplete(
    workflowRunId: string,
    def: IWorkflowDefinition,
    completedJobId: string,
    deps: JobCompletionHandlerDeps,
  ): Promise<void> {
    const jobs = def.jobs ?? [];
    const parallelGroups = this.dagResolver.findParallelJobs(
      this.dagResolver.buildDependencyGraph(jobs),
    );
    const currentLevel = findJobLevel(parallelGroups, completedJobId);

    for (
      let level = currentLevel + 1;
      currentLevel !== -1 && level < parallelGroups.length;
      level++
    ) {
      await this.enqueueEligibleDagNextJobs(
        workflowRunId,
        def,
        parallelGroups[level],
        deps,
      );
    }

    // Finalize once nothing is left to run. Checking after the enqueue/skip
    // pass is essential: skipping condition-false jobs marks them completed
    // without enqueuing work, so a workflow whose trailing DAG level is
    // entirely skipped would otherwise linger RUNNING with no driving job and
    // be wrongly reaped by the stale-run watchdog as container_lost.
    const allJobsCompleted = await areAllJobsCompleted({
      workflowRunId,
      jobs,
      getVariable: (path) => this.stateManager.getVariable(workflowRunId, path),
    });
    this.logger.debug(
      `progressDagOrComplete: ${completedJobId} at level ${currentLevel}/${parallelGroups.length}, allCompleted=${allJobsCompleted}`,
    );

    if (allJobsCompleted) {
      await this.completeWorkflowRun(workflowRunId, def, deps);
    }
  }

  /**
   * Transitions the run to its terminal COMPLETED state, emits the
   * run-completed event with timestamp-safe semantics (never overwrite an
   * already-set `completed_at`), and hands the concurrency scope back to the
   * queue so a queued sibling run can activate.
   */
  private async completeWorkflowRun(
    workflowRunId: string,
    def: IWorkflowDefinition,
    deps: JobCompletionHandlerDeps,
  ): Promise<void> {
    const run = await this.runRepo.findById(workflowRunId);
    const timestampPatch = run
      ? buildRunStatusTimestampPatch(run, WorkflowStatus.COMPLETED, new Date())
      : {};
    await this.runRepo.update(workflowRunId, {
      status: WorkflowStatus.COMPLETED,
      ...timestampPatch,
    });
    this.eventEmitter.emit(WORKFLOW_RUN_COMPLETED_EVENT, {
      workflowRunId,
      workflowId: def.workflow_id,
      status: WorkflowStatus.COMPLETED,
      stateVariables: run?.state_variables ?? {},
    } satisfies WorkflowRunEvent);

    this.logger.log(`Workflow run ${workflowRunId} completed successfully`);

    if (run) {
      await deps.tryActivateNextQueuedRun(run);
    }
  }

  /**
   * For each candidate at the next DAG level, decide whether to skip (missing
   * def, unsatisfied dependencies, false condition) or to enqueue. Records
   * the first eligible candidate so `current_step_id` reflects the live
   * successor after the loop.
   */
  private async enqueueEligibleDagNextJobs(
    workflowRunId: string,
    def: IWorkflowDefinition,
    nextJobs: string[],
    deps: JobCompletionHandlerDeps,
  ): Promise<void> {
    let firstEligibleNextJob: string | null = null;

    for (const nextJobId of nextJobs) {
      const selected = await this.tryAdvanceToNextJob(
        workflowRunId,
        def,
        nextJobId,
      );
      if (!selected) {
        continue;
      }
      if (firstEligibleNextJob === null) {
        firstEligibleNextJob = nextJobId;
      }
      await deps.enqueueJob(workflowRunId, def, nextJobId);
    }

    if (firstEligibleNextJob !== null) {
      await this.runRepo.update(workflowRunId, {
        current_step_id: firstEligibleNextJob,
      });
    }
  }

  /**
   * Single-job eligibility evaluation: returns true when the job exists in
   * the definition, all of its dependencies are completed, and any inline
   * `condition` / `if` evaluates to `true`. Side effects (skip markers,
   * strict-dependency rejection) are emitted as a function of the outcome.
   */
  private async tryAdvanceToNextJob(
    workflowRunId: string,
    def: IWorkflowDefinition,
    nextJobId: string,
  ): Promise<boolean> {
    const nextDef = def.jobs?.find((candidate) => candidate.id === nextJobId);
    if (!nextDef) {
      return false;
    }

    const allDependenciesCompleted = await areDependenciesCompleted({
      workflowRunId,
      job: nextDef,
      definition: def,
      dependsOn: nextDef.depends_on || [],
      getVariable: (path) => this.stateManager.getVariable(workflowRunId, path),
      getStateVariables: () =>
        this.stateManager.getStateVariables(workflowRunId),
    });
    if (!allDependenciesCompleted) {
      await skipStrictJobWhenDependencyResultsBlock({
        workflowRunId,
        definition: def,
        job: nextDef,
        getVariable: (path) =>
          this.stateManager.getVariable(workflowRunId, path),
        setVariable: (path, value) =>
          this.stateManager.setVariable(workflowRunId, path, value),
      });
      return false;
    }

    const jobCondition = nextDef.condition ?? nextDef.if;
    if (jobCondition) {
      const stateVariables =
        await this.stateManager.getStateVariables(workflowRunId);
      const renderedCondition = this.stateManager
        .substituteTemplate(jobCondition, stateVariables)
        .trim();
      if (renderedCondition !== 'true') {
        await markJobSkipped({
          workflowRunId,
          jobId: nextJobId,
          reason: 'condition_false',
          setVariable: (path, value) =>
            this.stateManager.setVariable(workflowRunId, path, value),
        });
        return false;
      }
    }

    return true;
  }
}
