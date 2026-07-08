import type { IWorkflowDefinition } from '@nexus/core';
import type { WorkflowRun } from './database/entities/workflow-run.entity';

/**
 * Callbacks injected by the parent service for cross-cutting concerns that
 * remain on the orchestrator: workflow definition loading (also used by the
 * failure path's retry scheduling), job enqueueing (also used by queue
 * activation), loop-iteration failure reporting (routes back through
 * `handleJobFailed`), and queue activation after terminal run completion.
 *
 * Keeping these as callbacks — instead of injecting the parent service — lets
 * `JobCompletionHandler` declare only the dependencies the completion path
 * actually uses, and avoids a circular service dependency.
 */
export interface JobCompletionHandlerDeps {
  loadWorkflowDefinition: (workflowId: string) => Promise<IWorkflowDefinition>;
  enqueueJob: (
    workflowRunId: string,
    def: IWorkflowDefinition,
    jobId: string,
  ) => Promise<void>;
  reportMaxLoopIterations: (
    workflowRunId: string,
    jobId: string,
    reason: string,
  ) => Promise<void>;
  tryActivateNextQueuedRun: (run: WorkflowRun) => Promise<unknown>;
}
