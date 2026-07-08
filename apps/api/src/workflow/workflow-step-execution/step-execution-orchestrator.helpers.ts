import type { StepEventPublisherService } from './step-event-publisher.service';
import type { StepSupportService } from './step-support.service';

export function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export async function publishJobStartEvent(
  eventPublisher: StepEventPublisherService,
  workflowRunId: string,
  jobId: string,
  bullJobId: string | number | undefined,
): Promise<void> {
  await eventPublisher.publishBestEffort(
    workflowRunId,
    eventPublisher.createEvent('job_start', {
      jobId,
      workflowRunId,
      bullJobId,
    }),
  );
}

export function resolveStateVariables(
  stateVariables: unknown,
): Record<string, unknown> {
  if (!stateVariables || typeof stateVariables !== 'object') {
    return {};
  }
  return stateVariables as Record<string, unknown>;
}

export function evaluateJobCondition(
  support: StepSupportService,
  condition: string,
  stateVariables: Record<string, unknown>,
): boolean {
  const evaluated = support.resolveJobInputs(
    { condition },
    stateVariables,
  ).condition;
  return evaluated === 'true' || evaluated === true;
}
