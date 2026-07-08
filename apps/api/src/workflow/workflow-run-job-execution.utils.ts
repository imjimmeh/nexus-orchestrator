import {
  IJob,
  IWorkflowDefinition,
  WorkflowStatus,
  IWorkflowTransition,
} from '@nexus/core';
import {
  WORKFLOW_RUN_ACTIVATED_FROM_QUEUE_EVENT,
  WORKFLOW_RUN_COMPLETED_EVENT,
} from './workflow-events.constants';
import {
  QueueActivationDeps,
  QueuedRunActivationOutcome,
  QueuedRunActivationReason,
} from './workflow-run-job-execution.types';
import {
  areNeedsSatisfied,
  buildJobNeedsContext,
  normalizeWorkflowJobNeeds,
} from './workflow-needs.utils';
import { MaxLoopIterationsExceededError } from './workflow-loop-guard.errors';
import { markJobSkipped } from './workflow-job-state.utils';
import { buildRunStatusTimestampPatch } from './workflow-run-status-timestamps.helper';

export function resolveStrictDependencies(
  definition: IWorkflowDefinition,
  job: IJob,
): boolean {
  return (
    job.strict_dependencies === true || definition.strict_dependencies === true
  );
}

export function buildDependentsByJob(jobs: IJob[]): Map<string, string[]> {
  const dependentsByJob = new Map<string, string[]>();
  for (const job of jobs) {
    dependentsByJob.set(job.id, []);
  }

  for (const job of jobs) {
    for (const dependency of normalizeWorkflowJobNeeds(job)) {
      const dependents = dependentsByJob.get(dependency.id);
      if (dependents) {
        dependents.push(job.id);
      }
    }
  }

  return dependentsByJob;
}

export function enqueueUnvisitedDependents(
  jobId: string,
  dependentsByJob: Map<string, string[]>,
  visited: Set<string>,
  queue: string[],
): void {
  const dependents = dependentsByJob.get(jobId) ?? [];
  for (const dependentId of dependents) {
    if (!visited.has(dependentId)) {
      queue.push(dependentId);
    }
  }
}

export function collectReachableJobs(
  jobs: IJob[],
  startJobId: string,
): Set<string> {
  const dependentsByJob = buildDependentsByJob(jobs);
  const visited = new Set<string>();
  const queue: string[] = [startJobId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);
    enqueueUnvisitedDependents(current, dependentsByJob, visited, queue);

    const currentJob = jobs.find((j) => j.id === current);
    if (currentJob?.transitions) {
      for (const transition of currentJob.transitions) {
        if (transition.next && !visited.has(transition.next)) {
          queue.push(transition.next);
        }
      }
    }
  }

  return visited;
}

export function findJobLevel(
  parallelGroups: string[][],
  jobId: string,
): number {
  for (let level = 0; level < parallelGroups.length; level++) {
    if (parallelGroups[level].includes(jobId)) {
      return level;
    }
  }

  return -1;
}

export async function areDependenciesCompleted(params: {
  workflowRunId: string;
  job?: IJob;
  definition?: IWorkflowDefinition;
  dependsOn: string[];
  getVariable: (path: string) => Promise<unknown>;
  getStateVariables?: () => Promise<Record<string, unknown>>;
}): Promise<boolean> {
  const strict =
    params.job && params.definition
      ? resolveStrictDependencies(params.definition, params.job)
      : false;

  if (strict && params.job && params.getStateVariables) {
    const needs = normalizeWorkflowJobNeeds(params.job);
    const needsContext = buildJobNeedsContext(await params.getStateVariables());
    return areNeedsSatisfied({ needs, context: needsContext });
  }

  for (const dependencyId of params.dependsOn) {
    const dependencyCompleted = await params.getVariable(
      `_internal.completed_jobs.${dependencyId}`,
    );
    if (dependencyCompleted !== true) {
      return false;
    }
  }

  return true;
}

export async function areDependencyJobsTerminal(params: {
  job: IJob;
  getVariable: (path: string) => Promise<unknown>;
}): Promise<boolean> {
  for (const dependency of normalizeWorkflowJobNeeds(params.job)) {
    const dependencyCompleted = await params.getVariable(
      `_internal.completed_jobs.${dependency.id}`,
    );
    if (dependencyCompleted !== true) {
      return false;
    }
  }

  return true;
}

export async function areAllJobsCompleted(params: {
  workflowRunId: string;
  jobs: IJob[];
  getVariable: (path: string) => Promise<unknown>;
}): Promise<boolean> {
  for (const job of params.jobs) {
    const completed = await params.getVariable(
      `_internal.completed_jobs.${job.id}`,
    );
    if (completed !== true) {
      return false;
    }
  }

  return true;
}

export type {
  QueueActivationDeps,
  QueuedRunActivationReason,
  QueuedRunActivationOutcome,
} from './workflow-run-job-execution.types';

/**
 * Activation reasons that mean the queued run can NEVER run and should be
 * cancelled rather than re-attempted.
 */
export const UNACTIVATABLE_PENDING_REASONS = [
  'workflow_unresolvable',
  'concurrency_not_queue',
] as const satisfies readonly QueuedRunActivationReason[];

export function isUnactivatablePendingReason(
  reason: QueuedRunActivationReason,
): boolean {
  return (
    UNACTIVATABLE_PENDING_REASONS as readonly QueuedRunActivationReason[]
  ).includes(reason);
}

export async function tryActivateNextQueuedRun(
  completedRun: {
    workflow_id: string;
    concurrency_scope?: string | null;
  },
  deps: QueueActivationDeps,
): Promise<QueuedRunActivationOutcome> {
  if (!completedRun.concurrency_scope) {
    return { activated: false, reason: 'no_concurrency_scope' };
  }

  const activationContext = await resolveQueuedRunActivationContext(
    completedRun,
    deps,
  );
  if (activationContext.status !== 'ready') {
    return { activated: false, reason: activationContext.status };
  }

  deps.logger.log(
    `Activating queued run ${activationContext.pendingRun.id} for workflow ${completedRun.workflow_id} scope=${completedRun.concurrency_scope}`,
  );

  await deps.runRepo.update(activationContext.pendingRun.id, {
    status: WorkflowStatus.RUNNING,
    ...buildRunStatusTimestampPatch(
      activationContext.pendingRun,
      WorkflowStatus.RUNNING,
      new Date(),
    ),
  });

  deps.eventEmitter.emit(WORKFLOW_RUN_ACTIVATED_FROM_QUEUE_EVENT, {
    workflowRunId: activationContext.pendingRun.id,
  });

  await enqueueFirstQueuedRunJobs(
    activationContext.pendingRun,
    activationContext.definition,
    deps,
  );
  return { activated: true, runId: activationContext.pendingRun.id };
}

type QueuedRunActivationContext =
  | {
      status: 'ready';
      definition: ReturnType<typeof resolveWorkflowDefinition>;
      pendingRun: {
        id: string;
        state_variables: Record<string, unknown>;
        started_at?: Date | null;
        completed_at?: Date | null;
      };
    }
  | { status: 'workflow_unresolvable' }
  | { status: 'concurrency_not_queue' }
  | { status: 'no_pending_run' };

async function resolveQueuedRunActivationContext(
  completedRun: {
    workflow_id: string;
    concurrency_scope?: string | null;
  },
  deps: QueueActivationDeps,
): Promise<QueuedRunActivationContext> {
  const workflow = await deps.workflowRepo.findByIdentifier(
    completedRun.workflow_id,
    { includeInactive: true },
  );
  if (!workflow) {
    return { status: 'workflow_unresolvable' };
  }

  const definition = resolveWorkflowDefinition(workflow.yaml_definition, deps);
  if (definition.concurrency?.on_conflict !== 'queue') {
    return { status: 'concurrency_not_queue' };
  }

  const pendingRun = await deps.runRepo.findOldestPendingByScope(
    completedRun.workflow_id,
    completedRun.concurrency_scope ?? '',
  );
  if (!pendingRun) {
    return { status: 'no_pending_run' };
  }

  return {
    status: 'ready',
    definition,
    pendingRun,
  };
}

function resolveWorkflowDefinition(
  yamlDefinition: string,
  deps: QueueActivationDeps,
) {
  const parsedDefinition = deps.parser.parseWorkflow(yamlDefinition);
  return deps.promptLoader
    ? deps.promptLoader.resolveWorkflowPrompts(parsedDefinition)
    : parsedDefinition;
}

async function enqueueFirstQueuedRunJobs(
  pendingRun: {
    id: string;
    state_variables: Record<string, unknown>;
    started_at?: Date | null;
    completed_at?: Date | null;
  },
  definition: ReturnType<typeof resolveWorkflowDefinition>,
  deps: QueueActivationDeps,
): Promise<void> {
  const jobs = definition.jobs ?? [];
  const graph = deps.dagResolver.buildDependencyGraph(jobs);
  const parallelGroups = deps.dagResolver.findParallelJobs(graph);

  if (parallelGroups.length > 0 && parallelGroups[0].length > 0) {
    const firstJobs = parallelGroups[0];
    await deps.runRepo.update(pendingRun.id, {
      current_step_id: firstJobs[0],
    });

    for (const jobId of firstJobs) {
      await deps.enqueueJob(pendingRun.id, definition, jobId);
    }
    return;
  }

  await deps.runRepo.update(pendingRun.id, {
    status: WorkflowStatus.COMPLETED,
    ...buildRunStatusTimestampPatch(
      pendingRun,
      WorkflowStatus.COMPLETED,
      new Date(),
    ),
  });
  deps.eventEmitter.emit(WORKFLOW_RUN_COMPLETED_EVENT, {
    workflowRunId: pendingRun.id,
    workflowId: '',
    status: WorkflowStatus.COMPLETED,
    stateVariables: pendingRun.state_variables,
  });
}

export async function resolveTransitionTarget(params: {
  workflowRunId: string;
  job: IJob;
  jobId: string;
  runRepo: {
    findById(
      id: string,
    ): Promise<{ state_variables?: Record<string, unknown> | null } | null>;
  };
  stateMachine: {
    evaluateTransition(
      transitions: IWorkflowTransition[] | undefined,
      context: Record<string, unknown>,
    ): string | null;
  };
  stateManager: {
    getVariable(runId: string, key: string): Promise<unknown>;
    setVariable(runId: string, key: string, value: unknown): Promise<unknown>;
  };
  logger: { error(msg: string): void };
}): Promise<string | null> {
  const updatedRun = await params.runRepo.findById(params.workflowRunId);
  const context = updatedRun?.state_variables || {};
  const nextJobId = params.stateMachine.evaluateTransition(
    params.job.transitions,
    context,
  );

  if (!nextJobId) {
    return null;
  }

  const loopCountKey = `_internal.loops.${params.jobId}.${nextJobId}`;
  const currentLoops =
    ((await params.stateManager.getVariable(
      params.workflowRunId,
      loopCountKey,
    )) as number) || 0;

  if (currentLoops >= 10) {
    params.logger.error(
      `Max iterations exceeded for loop ${params.jobId} -> ${nextJobId}`,
    );
    throw new MaxLoopIterationsExceededError(params.jobId, nextJobId);
  }

  await params.stateManager.setVariable(
    params.workflowRunId,
    loopCountKey,
    currentLoops + 1,
  );

  return nextJobId;
}

export async function enqueueTransitionJob(params: {
  workflowRunId: string;
  def: IWorkflowDefinition;
  jobId: string;
  nextJobId: string;
  stateManager: {
    getVariable(runId: string, key: string): Promise<unknown>;
    setVariable(runId: string, key: string, value: unknown): Promise<unknown>;
    getStateVariables(runId: string): Promise<Record<string, unknown>>;
    substituteTemplate(template: string, vars: Record<string, unknown>): string;
  };
  runRepo: {
    update(id: string, partial: Record<string, unknown>): Promise<unknown>;
  };
  enqueueJob(
    runId: string,
    def: IWorkflowDefinition,
    jobId: string,
  ): Promise<void>;
  logger: { debug(msg: string): void };
}): Promise<void> {
  const jobs = params.def.jobs ?? [];
  const selectedBranchJobs = collectReachableJobs(jobs, params.nextJobId);

  for (const candidate of jobs) {
    if (candidate.id === params.jobId) {
      continue;
    }

    const inSelectedBranch = selectedBranchJobs.has(candidate.id);
    if (!inSelectedBranch) {
      await params.stateManager.setVariable(
        params.workflowRunId,
        `_internal.queued_jobs.${candidate.id}`,
        true,
      );
      await markJobSkipped({
        workflowRunId: params.workflowRunId,
        jobId: candidate.id,
        reason: `branch_not_selected:${params.jobId}->${params.nextJobId}`,
        setVariable: (path, value) =>
          params.stateManager.setVariable(params.workflowRunId, path, value),
      });
      continue;
    }

    if (candidate.id !== params.nextJobId) {
      const completed = await params.stateManager.getVariable(
        params.workflowRunId,
        `_internal.completed_jobs.${candidate.id}`,
      );
      if (completed !== true) {
        await params.stateManager.setVariable(
          params.workflowRunId,
          `_internal.queued_jobs.${candidate.id}`,
          false,
        );
        await params.stateManager.setVariable(
          params.workflowRunId,
          `_internal.completed_jobs.${candidate.id}`,
          false,
        );
      }
    }
  }

  const nextDef = params.def.jobs?.find(
    (candidate) => candidate.id === params.nextJobId,
  );
  if (nextDef) {
    const jobCondition = nextDef.condition ?? nextDef.if;
    if (jobCondition) {
      const stateVariables = await params.stateManager.getStateVariables(
        params.workflowRunId,
      );
      const renderedCondition = params.stateManager
        .substituteTemplate(jobCondition, stateVariables)
        .trim();
      if (renderedCondition !== 'true') {
        await markJobSkipped({
          workflowRunId: params.workflowRunId,
          jobId: params.nextJobId,
          reason: 'condition_false',
          setVariable: (path, value) =>
            params.stateManager.setVariable(params.workflowRunId, path, value),
        });
        return;
      }
    }
  }

  await params.runRepo.update(params.workflowRunId, {
    current_step_id: params.nextJobId,
  });
  params.logger.debug(
    `Transitioning workflow run ${params.workflowRunId} from ${params.jobId} to ${params.nextJobId}`,
  );
  await params.enqueueJob(params.workflowRunId, params.def, params.nextJobId);
}
