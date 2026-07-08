import type { IWorkflowDefinition } from '@nexus/core';
import type { WorkflowRun } from './database/entities/workflow-run.entity';

/**
 * Callbacks injected by the parent service for cross-cutting concerns that
 * remain on the orchestrator: workflow definition loading (also used by the
 * completion path), salvage completion (re-enters `handleJobComplete` so the
 * success-path guards run unchanged), and queued-run activation after a
 * terminal FAILED transition.
 *
 * Keeping these as callbacks — instead of injecting the parent service — lets
 * `JobFailureHandler` declare only the dependencies the failure path actually
 * uses, and avoids a circular service dependency.
 */
export interface JobFailureHandlerDeps {
  loadWorkflowDefinition: (workflowId: string) => Promise<IWorkflowDefinition>;
  completeJob: (
    workflowRunId: string,
    jobId: string,
    output: Record<string, unknown>,
  ) => Promise<void>;
  tryActivateNextQueuedRun: (run: WorkflowRun) => Promise<unknown>;
}
