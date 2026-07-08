import type { ExecutionHeartbeatService } from '../execution-lifecycle/execution-heartbeat.service';
import type { WorkflowRunHeartbeatService } from '../workflow/workflow-run-operations/workflow-run-heartbeat.service';

export type ExecutionHeartbeatParams = {
  executionHeartbeat?: Pick<ExecutionHeartbeatService, 'recordActivity'>;
  runHeartbeat?: Pick<WorkflowRunHeartbeatService, 'recordActivity'>;
};
