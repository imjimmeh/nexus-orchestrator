import { EventEmitter2 } from '@nestjs/event-emitter';
import { IJob, IWorkflowDefinition } from '@nexus/core';

export interface QueueActivationDeps {
  workflowRepo: {
    findByIdentifier: (
      identifier: string,
      options?: { includeInactive?: boolean },
    ) => Promise<{ yaml_definition: string } | null>;
  };
  runRepo: {
    findOldestPendingByScope: (
      workflowId: string,
      scope: string,
    ) => Promise<{
      id: string;
      state_variables: Record<string, unknown>;
      started_at?: Date | null;
      completed_at?: Date | null;
    } | null>;
    update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  };
  parser: { parseWorkflow: (yaml: string) => IWorkflowDefinition };
  promptLoader?: {
    resolveWorkflowPrompts: (
      definition: IWorkflowDefinition,
    ) => IWorkflowDefinition;
  };
  dagResolver: {
    buildDependencyGraph: (jobs: IJob[]) => Map<string, string[]>;
    findParallelJobs: (graph: Map<string, string[]>) => string[][];
  };
  stateManager: {
    setVariable: (runId: string, key: string, value: unknown) => Promise<void>;
  };
  eventEmitter: EventEmitter2;
  enqueueJob: (
    runId: string,
    def: IWorkflowDefinition,
    jobId: string,
  ) => Promise<void>;
  logger: { log: (message: string) => void };
}

/**
 * Why a queued (PENDING) run could not be activated into RUNNING.
 *
 * `workflow_unresolvable` and `concurrency_not_queue` are PERMANENT: the run can
 * never activate (its workflow is gone, or the workflow's concurrency policy no
 * longer queues). The reconciliation watchdog uses these to terminate orphaned
 * queues instead of retrying activation forever.
 */
export type QueuedRunActivationReason =
  | 'no_concurrency_scope'
  | 'workflow_unresolvable'
  | 'concurrency_not_queue'
  | 'no_pending_run';

export type QueuedRunActivationOutcome =
  | { activated: true; runId: string }
  | { activated: false; reason: QueuedRunActivationReason };
