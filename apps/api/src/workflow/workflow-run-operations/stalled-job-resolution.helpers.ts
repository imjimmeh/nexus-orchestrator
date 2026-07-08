import type { ExecutionEntity } from '../../execution-lifecycle/database/entities/execution.entity';
import type { ContainerLivenessProbe } from '../../execution-lifecycle/execution-supervisor.service';
import type { WorkflowRun } from '../database/entities/workflow-run.entity';

interface InternalState {
  current_job_id?: string;
  completed_jobs?: Record<string, boolean>;
}

/**
 * Which jobs should the stale-run watchdog act on?
 *
 * `current_step_id` is frozen at the first job for parallel-job workflows, so
 * recovery must derive targets from per-job state: every job that has started
 * (has an entry in `state_variables.jobs`) but is not marked completed.
 */
export function resolveStalledJobIds(run: WorkflowRun): string[] {
  const state = run.state_variables ?? {};
  const internal = (state._internal ?? {}) as InternalState;
  const jobs = (state.jobs ?? {}) as Record<string, unknown>;
  const completed = internal.completed_jobs ?? {};

  const stalled = Object.keys(jobs).filter((jobId) => !completed[jobId]);
  if (stalled.length > 0) {
    return stalled;
  }
  if (internal.current_job_id) {
    return [internal.current_job_id];
  }
  return run.current_step_id ? [run.current_step_id] : [];
}

/**
 * Indexes a workflow_step execution into the parent-container and
 * parent-execution maps keyed by run id.
 */
export function indexParentExecution(
  execution: ExecutionEntity,
  runId: string,
  parentContainerIdsByRunId: Map<string, Set<string>>,
  parentExecutionIdsByRunId: Map<string, Set<string>>,
): void {
  if (execution.container_id) {
    addToMapSet(parentContainerIdsByRunId, runId, execution.container_id);
  }
  if (execution.id) {
    addToMapSet(parentExecutionIdsByRunId, runId, execution.id);
  }
}

/**
 * Structural watchdog immunity: immunises any run that has a non-terminal
 * workflow_step AND a non-terminal child subagent. The step awaiting a child
 * is structurally active regardless of heartbeat age — the orphan reconciler
 * (not the watchdog) is responsible for cleaning up truly stale children.
 *
 * A hung child (non-terminal but not progressing) is still reaped by the
 * supervisor's idle_timeout / max_runtime_exceeded paths, which are
 * heartbeat-independent and apply to subagent executions. This function
 * deliberately defers to those paths rather than racing them with a
 * stale-run watchdog retry.
 */
export function immuniseRunsWithLiveChild(
  executions: ExecutionEntity[],
  parentContainerIdsByRunId: Map<string, Set<string>>,
  activeRunIds: Set<string>,
): void {
  const runsWithLiveChild = new Set(
    executions
      .filter((e) => e.kind === 'subagent' && e.workflow_run_id)
      .map((e) => e.workflow_run_id as string),
  );
  for (const runId of runsWithLiveChild) {
    if (parentContainerIdsByRunId.has(runId)) {
      activeRunIds.add(runId);
    }
  }
}

/**
 * Container-liveness immunity for the stale-run watchdog: mirrors the
 * supervisor's treatment of `workflow_step` executions, which never heartbeat
 * through the telemetry gateway. A long-running `run_command` step (e.g. the
 * merge quality gate's full test suite) buffers its output and emits no
 * heartbeat while it runs, so its execution looks stale even though the
 * container is alive and busy. Each candidate's container is probed; a run with
 * an alive container is immunised so the watchdog does not kill healthy work.
 * Genuine container loss is deferred to the supervisor's debounced
 * `container_lost` reaper. A probe failure is non-fatal — the run is left
 * unimmunised so the normal recovery path can still act on a genuinely dead run.
 */
export async function immuniseRunsWithLiveStepContainer(
  candidates: ExecutionEntity[],
  activeRunIds: Set<string>,
  probe: ContainerLivenessProbe,
  onProbeError: (message: string) => void,
): Promise<void> {
  await Promise.all(
    candidates.map(async (execution) => {
      const runId = execution.workflow_run_id;
      const containerId = execution.container_id;
      if (!runId || !containerId || activeRunIds.has(runId)) {
        return;
      }
      try {
        const lost = await probe.isContainerLost(containerId);
        if (!lost) {
          activeRunIds.add(runId);
        }
      } catch (error) {
        onProbeError(
          `Container liveness probe failed for run ${runId} container ${containerId}: ${(error as Error).message}`,
        );
      }
    }),
  );
}

function addToMapSet(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  let set = map.get(key);
  if (!set) {
    set = new Set<string>();
    map.set(key, set);
  }
  set.add(value);
}
