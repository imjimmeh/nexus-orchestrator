import { StepEventPublisherService } from './step-event-publisher.service';
import type { IWorkflowEngineService } from '../kernel/interfaces/workflow-kernel.ports';

/**
 * Shared turn-end completion seam used by both agent step execution and
 * special-step execution.
 *
 * The `payloadField` parameter picks the field name used to label the
 * workflow run's completion scope inside the published `turn_end` event
 * payload. Agent execution publishes `jobId` (the historical contract);
 * special-step execution publishes `stepId` so consumers can correlate the
 * event back to the originating step rather than the parent job. Defaults to
 * `'jobId'` so existing agent call sites are unaffected.
 */
export async function publishTurnEndAndCompleteCore(params: {
  workflowEngine: IWorkflowEngineService;
  eventPublisher: StepEventPublisherService;
  workflowRunId: string;
  jobId: string;
  output: Record<string, unknown>;
  payloadField?: 'jobId' | 'stepId';
}): Promise<void> {
  await params.workflowEngine.handleJobComplete(
    params.workflowRunId,
    params.jobId,
    params.output,
  );

  await publishTurnEndCore(params);
}

export async function publishTurnEndCore(params: {
  eventPublisher: StepEventPublisherService;
  workflowRunId: string;
  jobId: string;
  output: Record<string, unknown>;
  payloadField?: 'jobId' | 'stepId';
}): Promise<void> {
  const payloadField = params.payloadField ?? 'jobId';
  const payload: Record<string, unknown> = {
    output: params.output,
  };
  payload[payloadField] = params.jobId;

  await params.eventPublisher.publishBestEffort(
    params.workflowRunId,
    params.eventPublisher.createEvent('turn_end', payload),
  );
}
