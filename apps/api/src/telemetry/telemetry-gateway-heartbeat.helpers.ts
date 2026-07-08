import type { ExecutionHeartbeatService } from '../execution-lifecycle/execution-heartbeat.service';
import type { WorkflowRunHeartbeatService } from '../workflow/workflow-run-operations/workflow-run-heartbeat.service';
import type { AuthenticatedSocket } from './types';

export type { ExecutionHeartbeatParams } from './telemetry-gateway-heartbeat.helpers.types';

export function maybeRecordSubagentHeartbeat(
  client: AuthenticatedSocket,
  executionHeartbeat:
    | Pick<ExecutionHeartbeatService, 'recordActivity'>
    | undefined,
  source: string,
): void {
  if (client.isSubagent && client.subagentExecutionId) {
    executionHeartbeat?.recordActivity(client.subagentExecutionId, source);
  }
}

/**
 * Touches the workflow run row so the stale-run watchdog sees agent telemetry
 * as liveness. Fire-and-poll dispatch keeps no queue job while the agent
 * works, so without this an actively streaming run looks stalled once it
 * exceeds the watchdog grace window.
 */
export function maybeRecordRunHeartbeat(
  client: AuthenticatedSocket,
  runHeartbeat: Pick<WorkflowRunHeartbeatService, 'recordActivity'> | undefined,
): void {
  if (client.workflowRunId) {
    runHeartbeat?.recordActivity(client.workflowRunId);
  }
}
