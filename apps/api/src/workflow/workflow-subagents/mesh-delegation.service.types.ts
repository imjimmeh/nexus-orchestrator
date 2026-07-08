import { getWorkflowLifecycleStatuses } from '@nexus/core';
import type {
  DelegationContract,
  DelegationContractStatus,
  DelegationTargetTier,
} from '../database/entities/delegation-contract.entity';
import type { WorkflowLifecycleStage } from '../workflow-stage-skill-policy.service.types';
import type { MeshDelegationGovernanceDecision } from './mesh-delegation-governance.service.types';

export interface MeshDelegationCreateParams {
  workflowRunId: string;
  parentContainerId: string;
  parentExecutionId: string | null;
  requesterAgentProfile: string | null;
  objective: string;
  taskPrompt: string;
  successCriteria: string[];
  targetAgentProfile: string;
  requestedTools: string[];
  targetTier: DelegationTargetTier;
  assignedFiles: string[];
  allowedTools: string[];
  deniedTools: string[];
  tokenBudget: number | null;
  timeBudgetMs: number | null;
  maxRetries: number;
  queuePriority: number;
  escalationPath: string[];
  expectedArtifacts: string[];
  metadata: Record<string, unknown> | null;
  parentDelegationId: string | null;
  parentTraceId: string | null;
  allowPrivilegedTools: boolean;
  lifecycleStage: WorkflowLifecycleStage | null;
}

export interface MeshDelegationSpawnRequest {
  contractId: string;
  workflowRunId: string;
  parentContainerId: string;
  lifecycleStage: WorkflowLifecycleStage | null;
  agentProfile: string;
  taskPrompt: string;
  tools: string[];
  tier: DelegationTargetTier;
  assignedFiles: string[];
  traceId: string;
  parentTraceId: string | null;
}

export interface MeshDelegationCancelRequest {
  workflowRunId: string;
  parentContainerId: string;
  subagentExecutionId: string;
  reason: string;
}

export type MeshDelegationSpawnHandler = (
  params: MeshDelegationSpawnRequest,
) => Promise<string>;

export type MeshDelegationCancelHandler = (
  params: MeshDelegationCancelRequest,
) => Promise<boolean>;

export interface MeshDelegationDispatchParams {
  workflowRunId: string;
  parentContainerId: string;
  lifecycleStage: WorkflowLifecycleStage | null;
  spawnHandler: MeshDelegationSpawnHandler;
}

export interface MeshDelegationDispatchResult {
  workflowRunId: string;
  parentContainerId: string;
  dispatchedContractIds: string[];
  failedContractIds: string[];
  queuedCount: number;
  runningCount: number;
  backpressure: boolean;
}

export interface MeshDelegationCreateResult {
  contract: DelegationContract;
  governanceDecision: MeshDelegationGovernanceDecision;
  dispatchResult: MeshDelegationDispatchResult | null;
}

export interface MeshDelegationCompletionParams {
  subagentExecutionId: string;
  result: Record<string, unknown>;
}

export interface MeshDelegationCancellationParams {
  subagentExecutionId: string;
  reason: string;
}

export interface MeshDelegationCancelParams {
  workflowRunId: string;
  contractId: string;
  reason: string;
  cancelHandler?: MeshDelegationCancelHandler;
}

export interface MeshDelegationCancelResult {
  contract: DelegationContract;
  cancelled: boolean;
}

export interface MeshDelegationReplayResult {
  workflowRunId: string;
  contracts: DelegationContract[];
  lifecycleEvents: Array<{
    id: string;
    eventType: string;
    timestamp: Date;
    actorId: string | undefined;
    payload: Record<string, unknown> | undefined;
  }>;
}

export interface MeshDelegationSweepParams {
  workflowRunId?: string;
  cancelHandler?: MeshDelegationCancelHandler;
}

export interface MeshDelegationSweepResult {
  timedOutContractIds: string[];
  requeuedContractIds: string[];
  failedToCancelContractIds: string[];
}

export const MESH_DELEGATION_ACTIVE_STATUSES: DelegationContractStatus[] = [
  ...getWorkflowLifecycleStatuses('meshDelegationActive'),
] as DelegationContractStatus[];

export const MESH_DELEGATION_QUEUE_STATUS: DelegationContractStatus = 'queued';

export const MESH_DELEGATION_TERMINAL_STATUSES: DelegationContractStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'denied',
];
