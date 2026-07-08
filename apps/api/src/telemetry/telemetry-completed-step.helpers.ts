import type { AuthenticatedSocket } from './types';

function getSocketStepKey(client: AuthenticatedSocket): string | undefined {
  if (!client.stepId) {
    return undefined;
  }

  return `${client.jobId ?? 'unknown-job'}:${client.stepId}`;
}

export function markSocketStepCompleted(client: AuthenticatedSocket): void {
  const stepKey = getSocketStepKey(client);
  if (!stepKey) {
    return;
  }

  client.completedStepKey = stepKey;
}

export function isTelemetryForCompletedStep(
  client: AuthenticatedSocket,
): boolean {
  const stepKey = getSocketStepKey(client);
  return stepKey !== undefined && client.completedStepKey === stepKey;
}
