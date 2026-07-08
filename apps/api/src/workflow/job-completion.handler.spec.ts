import { describe, expect, it, vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import {
  WORKFLOW_JOB_COMPLETED_EVENT,
  WORKFLOW_RUN_COMPLETED_EVENT,
} from './workflow-events.constants';
import { JobCompletionHandler } from './job-completion.handler';
import type { JobCompletionHandlerDeps } from './job-completion.handler.types';
import { markJobCompleted } from './workflow-job-state.utils';

/**
 * Tests for the extracted `JobCompletionHandler`.
 *
 * These cover the same success-path scenarios that used to live inline in
 * `WorkflowRunJobExecutionService.handleJobComplete`. The public service is
 * now a thin orchestrator that delegates here; this suite pins the behavior
 * that the delegation must preserve.
 */
describe('JobCompletionHandler', () => {
  const createHandler = () => {
    const runRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'run-1',
        workflow_id: 'wf-1',
        status: WorkflowStatus.RUNNING,
        state_variables: {},
      }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const questionPark = {
      // Mirror the real service: parked runs suspend, everything else completes.
      resolveParkedTurnEnd: vi
        .fn()
        .mockImplementation(
          async (run: { wait_reason?: unknown; awaiting_input?: unknown }) =>
            run?.wait_reason || run?.awaiting_input ? 'suspend' : 'complete',
        ),
    };
    const stateManager = {
      getVariable: vi.fn().mockResolvedValue(null),
      getStateVariables: vi.fn().mockResolvedValue({}),
      setVariable: vi.fn().mockResolvedValue(undefined),
      deleteVariable: vi.fn().mockResolvedValue(undefined),
      tryMarkJobCompleted: vi.fn(),
      substituteTemplate: vi.fn((value: string) => value),
    };
    // Mirrors the atomic compare-and-set: the first completion of a (run, job)
    // wins; a duplicate terminal-write trigger for the same pair is rejected.
    const completionClaims = new Set<string>();
    stateManager.tryMarkJobCompleted.mockImplementation(
      async (workflowRunId: string, jobId: string) => {
        const claimKey = `${workflowRunId}:${jobId}`;
        if (completionClaims.has(claimKey)) {
          return false;
        }
        completionClaims.add(claimKey);
        return true;
      },
    );
    const eventEmitter = { emit: vi.fn() };
    const stateMachine = {
      evaluateTransition: vi.fn().mockReturnValue(null),
    };
    const dagResolver = {
      buildDependencyGraph: vi.fn().mockReturnValue(new Map()),
      findParallelJobs: vi.fn().mockReturnValue([]),
    };

    const handler = new JobCompletionHandler(
      runRepo as never,
      questionPark as never,
      stateManager as never,
      eventEmitter,
      stateMachine as never,
      dagResolver as never,
    );

    const loadWorkflowDefinition = vi
      .fn()
      .mockImplementation(async (workflowId: string) => ({
        workflow_id: workflowId,
        name: 'WF',
        jobs: [],
      }));
    const enqueueJob = vi.fn().mockResolvedValue(undefined);
    const reportMaxLoopIterations = vi.fn().mockResolvedValue(undefined);
    const tryActivateNextQueuedRun = vi.fn().mockResolvedValue({
      activated: false,
      reason: 'no_concurrency_scope',
    });

    const deps: JobCompletionHandlerDeps = {
      loadWorkflowDefinition,
      enqueueJob,
      reportMaxLoopIterations,
      tryActivateNextQueuedRun,
    };

    return {
      handler,
      runRepo,
      questionPark,
      stateManager,
      eventEmitter,
      stateMachine,
      dagResolver,
      loadWorkflowDefinition,
      enqueueJob,
      reportMaxLoopIterations,
      tryActivateNextQueuedRun,
      call: (
        workflowRunId: string,
        jobId: string,
        output: Record<string, unknown>,
      ) => handler.handle(workflowRunId, jobId, output, deps),
    };
  };

  it('loads workflow definitions by workflow identifier when completing a run', async () => {
    const { call, loadWorkflowDefinition, stateMachine } = createHandler();
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'project_orchestration_cycle_ceo',
      name: 'Project Orchestration Cycle',
      jobs: [{ id: 'job-1' }],
    });

    await call('run-1', 'job-1', { decision: 'continue' });

    expect(loadWorkflowDefinition).toHaveBeenCalledWith('wf-1');
    expect(stateMachine.evaluateTransition).toHaveBeenCalled();
  });

  it('clears auto-retry state for a job that completes successfully', async () => {
    const { call, loadWorkflowDefinition, stateManager } = createHandler();
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'project_orchestration_cycle_ceo',
      name: 'Project Orchestration Cycle',
      jobs: [{ id: 'job-1' }],
    });

    await call('run-1', 'job-1', { ok: true });

    expect(stateManager.deleteVariable).toHaveBeenCalledWith(
      'run-1',
      '_internal.auto_retry.job-1',
    );
    expect(stateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      '_internal.completed_jobs.job-1',
      true,
    );
  });

  it('emits job completion payload with output diagnostics', async () => {
    const { call, eventEmitter, loadWorkflowDefinition } = createHandler();
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'project_orchestration_cycle_ceo',
      name: 'Project Orchestration Cycle',
      jobs: [{ id: 'job-1' }],
    });

    await call('run-1', 'job-1', {
      ok: false,
      merge_outcome: 'failed',
      merge_message: 'Command failed: git merge --no-ff --no-edit feature/x',
    });

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_JOB_COMPLETED_EVENT,
      expect.objectContaining({
        payload: expect.objectContaining({
          outputOk: false,
          outputErrorMessage:
            'Command failed: git merge --no-ff --no-edit feature/x',
        }),
      }),
    );
  });

  it('dispatches successors only once when the terminal-write router fires twice for the same job', async () => {
    const { call, eventEmitter, loadWorkflowDefinition } = createHandler();
    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'review_workflow',
      name: 'Review Workflow',
      jobs: [{ id: 'review_resource' }],
    });

    // Path A (synchronous turn-end) and Path B (async execution.completed
    // listener) both route into handle for the same (run, job).
    await call('run-1', 'review_resource', { ok: true });
    await call('run-1', 'review_resource', { ok: true });

    const completionEmits = eventEmitter.emit.mock.calls.filter(
      ([eventName]) => eventName === WORKFLOW_JOB_COMPLETED_EVENT,
    );
    expect(completionEmits).toHaveLength(1);
  });

  it('emits the run completed event when the final job completes the run', async () => {
    const {
      call,
      eventEmitter,
      loadWorkflowDefinition,
      runRepo,
      stateManager,
    } = createHandler();

    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'single_job_workflow',
      name: 'Single Job Workflow',
      jobs: [{ id: 'job-1' }],
    });
    // The sole job is recorded as completed so the run reaches terminal COMPLETED.
    stateManager.getVariable.mockImplementation(async (_runId, path: string) =>
      path === '_internal.completed_jobs.job-1' ? true : null,
    );

    await call('run-1', 'job-1', { ok: true });

    expect(runRepo.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'COMPLETED' }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_COMPLETED_EVENT,
      expect.objectContaining({
        workflowRunId: 'run-1',
        status: 'COMPLETED',
      }),
    );
  });

  it('emits the workflow definition id on the completed-run event', async () => {
    const { call, eventEmitter, loadWorkflowDefinition, stateManager } =
      createHandler();

    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'run_retrospective',
      name: 'Retrospective Analyst',
      jobs: [{ id: 'analyze' }],
    });
    stateManager.getVariable.mockImplementation(async (_runId, path: string) =>
      path === '_internal.completed_jobs.analyze' ? true : null,
    );

    await call('analyst-run-1', 'analyze', { ok: true });

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      WORKFLOW_RUN_COMPLETED_EVENT,
      expect.objectContaining({
        workflowId: 'run_retrospective',
        workflowRunId: 'analyst-run-1',
      }),
    );
  });

  it('does not overwrite completed_at when completing a run that already has one', async () => {
    const { call, loadWorkflowDefinition, runRepo, stateManager } =
      createHandler();

    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'single_job_workflow',
      name: 'Single Job Workflow',
      jobs: [{ id: 'job-1' }],
    });
    // Run already has completed_at set (e.g. duplicate terminal-write trigger)
    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.RUNNING,
      started_at: new Date('2026-06-19T09:00:00.000Z'),
      completed_at: new Date('2026-06-19T10:00:00.000Z'),
      state_variables: {},
    });
    stateManager.getVariable.mockImplementation(async (_runId, path: string) =>
      path === '_internal.completed_jobs.job-1' ? true : null,
    );

    await call('run-1', 'job-1', { ok: true });

    const completingUpdate = runRepo.update.mock.calls.find(
      ([, data]: [string, Record<string, unknown>]) =>
        data.status === WorkflowStatus.COMPLETED,
    );
    expect(completingUpdate?.[1]).not.toHaveProperty('completed_at');
  });

  it('does not complete a parked run when its final job turn ends (wait_reason=dependency)', async () => {
    const {
      call,
      eventEmitter,
      loadWorkflowDefinition,
      runRepo,
      stateManager,
    } = createHandler();

    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'single_job_workflow',
      name: 'Single Job Workflow',
      jobs: [{ id: 'job-1' }],
    });
    // The run is RUNNING but parked on a dependency await: the agent suspended
    // via await_agent_workflow and its turn ended. It must NOT complete.
    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: 'RUNNING',
      wait_reason: 'dependency',
      state_variables: {},
    });
    stateManager.getVariable.mockImplementation(async (_runId, path: string) =>
      path === '_internal.completed_jobs.job-1' ? true : null,
    );

    await call('run-1', 'job-1', { ok: true });

    expect(runRepo.update).not.toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'COMPLETED' }),
    );
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      WORKFLOW_RUN_COMPLETED_EVENT,
      expect.anything(),
    );
  });

  it('does not progress a parked run to its next job when the current turn ends', async () => {
    const { call, loadWorkflowDefinition, runRepo, stateManager, enqueueJob } =
      createHandler();

    loadWorkflowDefinition.mockResolvedValue({
      workflow_id: 'two_job_workflow',
      name: 'Two Job Workflow',
      jobs: [{ id: 'job-1' }, { id: 'job-2', depends_on: ['job-1'] }],
    });
    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: 'RUNNING',
      wait_reason: 'dependency',
      state_variables: {},
    });
    stateManager.getVariable.mockResolvedValue(null);

    await call('run-1', 'job-1', { ok: true });

    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('merges previously captured output fields into final job output', async () => {
    const { stateManager } = createHandler();

    stateManager.getVariable.mockResolvedValue({
      decision: 'accept',
      feedback: 'Looks good',
    });

    await markJobCompleted({
      workflowRunId: 'run-1',
      jobId: 'review_resource',
      output: {
        ok: true,
        response: 'Done',
      },
      getVariable: (path) => stateManager.getVariable('run-1', path),
      setVariable: (path, value) =>
        stateManager.setVariable('run-1', path, value),
    });

    expect(stateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      'jobs.review_resource.output',
      {
        decision: 'accept',
        feedback: 'Looks good',
        ok: true,
        response: 'Done',
      },
    );
    expect(stateManager.setVariable).toHaveBeenCalledWith(
      'run-1',
      '_internal.completed_jobs.review_resource',
      true,
    );
  });

  it('enqueues far downstream rejoin jobs when a shorter branch completes last', async () => {
    const {
      call,
      loadWorkflowDefinition,
      dagResolver,
      stateManager,
      enqueueJob,
    } = createHandler();

    const state = new Map<string, unknown>();
    stateManager.getVariable.mockImplementation(
      async (_workflowRunId: string, path: string) =>
        state.has(path) ? state.get(path) : null,
    );
    stateManager.setVariable.mockImplementation(
      async (_workflowRunId: string, path: string, value: unknown) => {
        state.set(path, value);
      },
    );

    const definition = {
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [
        { id: 'persist_implementation_plan' },
        { id: 'materialize_refinement_subtasks' },
        {
          id: 'plan_validation',
          depends_on: ['persist_implementation_plan'],
        },
        {
          id: 'persist_subtask_materialization_errors',
          depends_on: ['materialize_refinement_subtasks'],
        },
        {
          id: 'deep_chain_1',
          depends_on: ['persist_subtask_materialization_errors'],
        },
        {
          id: 'deep_chain_2',
          depends_on: ['deep_chain_1'],
        },
        {
          id: 'deep_chain_3',
          depends_on: ['deep_chain_2'],
        },
        {
          id: 'validate_refinement_exit_readiness',
          depends_on: ['plan_validation', 'deep_chain_3'],
        },
        {
          id: 'mark_refinement_completed',
          depends_on: ['validate_refinement_exit_readiness'],
        },
      ],
    };

    loadWorkflowDefinition.mockResolvedValue(definition);
    dagResolver.buildDependencyGraph.mockReturnValue(new Map());
    dagResolver.findParallelJobs.mockReturnValue([
      ['persist_implementation_plan', 'materialize_refinement_subtasks'],
      ['plan_validation', 'persist_subtask_materialization_errors'],
      ['deep_chain_1'],
      ['deep_chain_2'],
      ['deep_chain_3'],
      ['validate_refinement_exit_readiness'],
      ['mark_refinement_completed'],
    ]);

    const preCompletedJobs = [
      'persist_implementation_plan',
      'materialize_refinement_subtasks',
      'persist_subtask_materialization_errors',
      'deep_chain_1',
      'deep_chain_2',
    ];

    for (const jobId of preCompletedJobs) {
      state.set(`_internal.completed_jobs.${jobId}`, true);
      state.set(`_internal.queued_jobs.${jobId}`, true);
      state.set(`jobs.${jobId}.output`, { ok: true });
    }

    state.set('_internal.queued_jobs.plan_validation', true);
    state.set('jobs.plan_validation.output', {});
    state.set('jobs.deep_chain_3.output', {});

    await call('run-1', 'deep_chain_3', { ok: true });

    // deep_chain_3 at level 4; the only level-5 candidate is
    // validate_refinement_exit_readiness, which depends on plan_validation
    // (still pending) — it must not be enqueued yet.
    expect(enqueueJob).not.toHaveBeenCalledWith(
      'run-1',
      definition,
      'validate_refinement_exit_readiness',
    );

    await call('run-1', 'plan_validation', { validation_result: 'passed' });

    // plan_validation at level 1; the level-5 candidate's dependencies are now
    // all satisfied, so it must be enqueued.
    expect(enqueueJob).toHaveBeenCalledWith(
      'run-1',
      definition,
      'validate_refinement_exit_readiness',
    );
  });

  describe('max loop iteration guard', () => {
    const setupLoopGuard = () => {
      const ctx = createHandler();
      const state = new Map<string, unknown>();
      ctx.stateManager.getVariable.mockImplementation(
        async (_workflowRunId: string, path: string) => {
          if (
            path === '_internal.loops.review_resource.record_feedback_reject'
          ) {
            return 10;
          }
          return state.has(path) ? state.get(path) : null;
        },
      );
      ctx.stateManager.setVariable.mockImplementation(
        async (_workflowRunId: string, path: string, value: unknown) => {
          state.set(path, value);
        },
      );

      ctx.loadWorkflowDefinition.mockResolvedValue({
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [
          {
            id: 'review_resource',
            transitions: [
              { target: 'record_feedback_reject', condition: 'always' },
            ],
          },
          { id: 'record_feedback_reject' },
        ],
      });

      ctx.runRepo.findById.mockResolvedValue({
        id: 'run-1',
        workflow_id: 'wf-1',
        status: WorkflowStatus.RUNNING,
        state_variables: {},
      });

      ctx.stateMachine.evaluateTransition.mockReturnValue(
        'record_feedback_reject',
      );

      return { ctx, state };
    };

    it('routes max loop iterations through handleJobFailed instead of directly failing', async () => {
      const { ctx } = setupLoopGuard();

      await ctx.call('run-1', 'review_resource', { decision: 'reject' });

      expect(ctx.reportMaxLoopIterations).toHaveBeenCalledWith(
        'run-1',
        'review_resource',
        expect.stringContaining('max_loop_iterations'),
      );
      expect(ctx.runRepo.update).not.toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: WorkflowStatus.FAILED }),
      );
    });

    it('does not bypass reportMaxLoopIterations for max loop iterations (no direct repo update)', async () => {
      const { ctx } = setupLoopGuard();

      await ctx.call('run-1', 'review_resource', { decision: 'reject' });

      expect(ctx.reportMaxLoopIterations).toHaveBeenCalledWith(
        'run-1',
        'review_resource',
        expect.stringContaining('max_loop_iterations'),
      );
    });
  });

  describe('condition evaluation before enqueue', () => {
    it('skips jobs with false conditions instead of enqueuing them', async () => {
      const {
        call,
        loadWorkflowDefinition,
        dagResolver,
        stateManager,
        enqueueJob,
      } = createHandler();

      const state = new Map<string, unknown>();
      stateManager.getVariable.mockImplementation(
        async (_workflowRunId: string, path: string) =>
          state.has(path) ? state.get(path) : null,
      );
      stateManager.setVariable.mockImplementation(
        async (_workflowRunId: string, path: string, value: unknown) => {
          state.set(path, value);
        },
      );
      stateManager.substituteTemplate = vi
        .fn()
        .mockImplementation((template: string) => {
          if (template.includes('skip_me')) {
            return 'false';
          }
          return template;
        });

      const definition = {
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [
          { id: 'always_runs_first' },
          {
            id: 'should_skip',
            depends_on: ['always_runs_first'],
            condition:
              '{{#if (and (eq skip_me true))}}true{{else}}false{{/if}}',
          },
          {
            id: 'final_step',
            depends_on: ['should_skip'],
          },
        ],
      };

      loadWorkflowDefinition.mockResolvedValue(definition);
      dagResolver.buildDependencyGraph.mockReturnValue(new Map());
      dagResolver.findParallelJobs.mockReturnValue([
        ['always_runs_first'],
        ['should_skip'],
        ['final_step'],
      ]);

      state.set('_internal.completed_jobs.always_runs_first', true);
      state.set('_internal.queued_jobs.always_runs_first', true);
      state.set('jobs.always_runs_first.output', { ok: true });

      enqueueJob.mockClear();

      await call('run-1', 'always_runs_first', { ok: true });

      expect(enqueueJob).not.toHaveBeenCalledWith(
        'run-1',
        definition,
        'should_skip',
      );

      expect(state.get('_internal.completed_jobs.should_skip')).toBe(true);
      expect(state.get('jobs.should_skip.result')).toBe('skipped');
      expect(state.get('jobs.should_skip.output')).toEqual({
        skipped: true,
        reason: 'condition_false',
      });
    });

    it('skips transition target with false condition instead of enqueuing', async () => {
      const {
        call,
        loadWorkflowDefinition,
        stateManager,
        stateMachine,
        enqueueJob,
      } = createHandler();

      const state = new Map<string, unknown>();
      stateManager.getVariable.mockImplementation(
        async (_workflowRunId: string, path: string) =>
          state.has(path) ? state.get(path) : null,
      );
      stateManager.setVariable.mockImplementation(
        async (_workflowRunId: string, path: string, value: unknown) => {
          state.set(path, value);
        },
      );
      stateManager.substituteTemplate = vi
        .fn()
        .mockImplementation((template: string) => {
          if (template.includes('skip_transition_target')) {
            return 'false';
          }
          return template;
        });

      const definition = {
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [
          {
            id: 'review_resource',
            transitions: [
              { target: 'conditional_target', condition: 'always' },
            ],
          },
          {
            id: 'conditional_target',
            condition:
              '{{#if (and (eq skip_transition_target true))}}true{{else}}false{{/if}}',
          },
        ],
      };

      loadWorkflowDefinition.mockResolvedValue(definition);
      stateMachine.evaluateTransition.mockReturnValue('conditional_target');

      await call('run-1', 'review_resource', { decision: 'continue' });

      expect(enqueueJob).not.toHaveBeenCalledWith(
        'run-1',
        definition,
        'conditional_target',
      );

      expect(state.get('_internal.completed_jobs.conditional_target')).toBe(
        true,
      );
      expect(state.get('jobs.conditional_target.result')).toBe('skipped');
      expect(state.get('jobs.conditional_target.output')).toEqual({
        skipped: true,
        reason: 'condition_false',
      });
    });

    it('finalizes the run when the entire trailing DAG frontier is condition-skipped', async () => {
      // Reproduces production runs 20ec23de + 60a7693d: a validation job
      // completes, then the whole tail (exit-readiness gate -> mark-completed ->
      // final-transition) is legitimately condition-skipped. Every job is now
      // terminal, so the run must reach COMPLETED — otherwise it lingers RUNNING
      // and the stale-run watchdog wrongly reaps it as container_lost and fails
      // the run.
      const {
        call,
        loadWorkflowDefinition,
        dagResolver,
        stateManager,
        runRepo,
        eventEmitter,
      } = createHandler();

      const state = new Map<string, unknown>();
      stateManager.getVariable.mockImplementation(
        async (_workflowRunId: string, path: string) =>
          state.has(path) ? state.get(path) : null,
      );
      stateManager.setVariable.mockImplementation(
        async (_workflowRunId: string, path: string, value: unknown) => {
          state.set(path, value);
        },
      );
      // Every tail job's gate renders false; plan_validation carries no
      // condition, so its own completion path is unaffected.
      stateManager.substituteTemplate = vi
        .fn()
        .mockImplementation((template: string) =>
          template.includes('exit_gate') ? 'false' : template,
        );

      const definition = {
        workflow_id: 'refinement_default',
        name: 'Refinement Default',
        jobs: [
          { id: 'plan_validation' },
          {
            id: 'exit_readiness_gate',
            depends_on: ['plan_validation'],
            condition: '{{#if exit_gate}}true{{else}}false{{/if}}',
          },
          {
            id: 'mark_completed',
            depends_on: ['exit_readiness_gate'],
            condition: '{{#if exit_gate}}true{{else}}false{{/if}}',
          },
          {
            id: 'final_transition',
            depends_on: ['mark_completed'],
            condition: '{{#if exit_gate}}true{{else}}false{{/if}}',
          },
        ],
      };

      loadWorkflowDefinition.mockResolvedValue(definition);
      dagResolver.buildDependencyGraph.mockReturnValue(new Map());
      dagResolver.findParallelJobs.mockReturnValue([
        ['plan_validation'],
        ['exit_readiness_gate'],
        ['mark_completed'],
        ['final_transition'],
      ]);

      await call('run-1', 'plan_validation', { validation_result: 'passed' });

      // The tail is skipped (marked completed, nothing enqueued)...
      expect(state.get('_internal.completed_jobs.final_transition')).toBe(true);
      // ...so the run must finalize rather than linger RUNNING.
      expect(runRepo.update).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: WorkflowStatus.COMPLETED }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WORKFLOW_RUN_COMPLETED_EVENT,
        expect.objectContaining({
          workflowRunId: 'run-1',
          status: WorkflowStatus.COMPLETED,
        }),
      );
    });
  });

  describe('question-park delegation (Fix C)', () => {
    const runningRun = (over: Record<string, unknown> = {}) => ({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.RUNNING,
      awaiting_input: false,
      wait_reason: null,
      state_variables: {},
      ...over,
    });

    it('suspends completion when questionPark returns "suspend"', async () => {
      const ctx = createHandler();
      ctx.runRepo.findById.mockResolvedValue(
        runningRun({ awaiting_input: true }),
      );
      ctx.questionPark.resolveParkedTurnEnd.mockResolvedValue('suspend');

      await ctx.call('run-1', 'job-1', {});

      expect(ctx.questionPark.resolveParkedTurnEnd).toHaveBeenCalled();
      expect(ctx.stateManager.tryMarkJobCompleted).not.toHaveBeenCalled();
    });

    it('proceeds to complete when questionPark returns "complete"', async () => {
      const ctx = createHandler();
      ctx.runRepo.findById.mockResolvedValue(
        runningRun({ awaiting_input: true }),
      );
      ctx.questionPark.resolveParkedTurnEnd.mockResolvedValue('complete');
      ctx.loadWorkflowDefinition.mockResolvedValue({
        workflow_id: 'wf-1',
        name: 'WF',
        jobs: [{ id: 'job-1' }],
      });

      await ctx.call('run-1', 'job-1', {});

      expect(ctx.stateManager.tryMarkJobCompleted).toHaveBeenCalledWith(
        'run-1',
        'job-1',
      );
    });

    it('delegates the loaded run and jobId to questionPark', async () => {
      const ctx = createHandler();
      const run = runningRun();
      ctx.runRepo.findById.mockResolvedValue(run);
      ctx.loadWorkflowDefinition.mockResolvedValue({
        workflow_id: 'wf-1',
        name: 'WF',
        jobs: [{ id: 'job-1' }],
      });

      await ctx.call('run-1', 'job-1', {});

      expect(ctx.questionPark.resolveParkedTurnEnd).toHaveBeenCalledWith(
        run,
        'job-1',
      );
    });
  });
});
