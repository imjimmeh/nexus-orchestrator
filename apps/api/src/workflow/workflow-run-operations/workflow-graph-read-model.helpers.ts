import { asRecord, WorkflowStatus, type IJob } from '@nexus/core';
import type {
  WorkflowGraphEdge as WorkflowGraphEdgeDto,
  WorkflowGraphNode as WorkflowGraphNodeDto,
  WorkflowNodeRuntimeStatus,
  WorkflowRunGraphSnapshot as WorkflowRunGraphDto,
} from '@nexus/core';
import type { WorkflowEvent } from '../database/entities/workflow-event.entity';
import type {
  RuntimeContext,
  StatusBuckets,
} from './workflow-graph-read-model.types';

export function asBooleanMap(value: unknown): Set<string> {
  const map = asRecord(value);
  return new Set(
    Object.entries(map)
      .filter(([, flag]) => flag === true)
      .map(([key]) => key),
  );
}

export function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    return value;
  }

  return null;
}

export function toJobNodeId(jobId: string): string {
  return `job:${jobId}`;
}

export function toStepNodeId(jobId: string, stepId: string): string {
  return `step:${jobId}:${stepId}`;
}

export function mapStepExecutionStatus(
  status: string | undefined,
): WorkflowNodeRuntimeStatus | null {
  if (status === 'pending') {
    return 'queued';
  }

  if (status === 'running') {
    return 'running';
  }

  if (status === 'completed') {
    return 'succeeded';
  }

  if (status === 'failed') {
    return 'failed';
  }

  return null;
}

export function createStatusBuckets(): StatusBuckets {
  return {
    activeNodeIds: [],
    queuedNodeIds: [],
    completedNodeIds: [],
    failedNodeIds: [],
  };
}

export function collectStatusNode(
  nodeId: string,
  status: WorkflowNodeRuntimeStatus,
  buckets: StatusBuckets,
): void {
  if (status === 'running' || status === 'waiting_input') {
    buckets.activeNodeIds.push(nodeId);
    return;
  }

  if (status === 'queued') {
    buckets.queuedNodeIds.push(nodeId);
    return;
  }

  if (status === 'succeeded') {
    buckets.completedNodeIds.push(nodeId);
    return;
  }

  if (status === 'failed') {
    buckets.failedNodeIds.push(nodeId);
  }
}

function hasUnmetDependencies(job: IJob, completedJobs: Set<string>): boolean {
  const dependencies = Array.isArray(job.depends_on) ? job.depends_on : [];
  if (dependencies.length === 0) {
    return false;
  }

  return dependencies.some((dependencyId) => !completedJobs.has(dependencyId));
}

function resolveTerminalRunJobStatus(params: {
  runStatus: WorkflowStatus | null;
  isCompleted: boolean;
  isFailed: boolean;
  isCurrentJob: boolean;
}): WorkflowNodeRuntimeStatus | null {
  const { runStatus, isCompleted, isFailed, isCurrentJob } = params;

  if (runStatus === null) {
    return 'idle';
  }

  if (isCompleted) {
    return 'succeeded';
  }

  if (isFailed) {
    return 'failed';
  }

  if (runStatus === WorkflowStatus.CANCELLED) {
    return 'cancelled';
  }

  if (runStatus === WorkflowStatus.COMPLETED) {
    return 'skipped';
  }

  if (runStatus === WorkflowStatus.FAILED && isCurrentJob) {
    return 'failed';
  }

  return null;
}

function resolveActiveRunJobStatus(params: {
  runStatus: WorkflowStatus | null;
  isCurrentJob: boolean;
  hasOutstandingQuestion: boolean;
  isQueued: boolean;
}): WorkflowNodeRuntimeStatus | null {
  const { runStatus, isCurrentJob, hasOutstandingQuestion, isQueued } = params;

  if (isCurrentJob && hasOutstandingQuestion) {
    return 'waiting_input';
  }

  if (runStatus === WorkflowStatus.RUNNING && isCurrentJob) {
    return 'running';
  }

  if (isQueued || runStatus === WorkflowStatus.PENDING) {
    return 'queued';
  }

  return null;
}

export function resolveJobStatus(params: {
  job: IJob;
  runtime: RuntimeContext;
}): WorkflowNodeRuntimeStatus {
  const { job, runtime } = params;
  const isCurrentJob = runtime.currentJobId === job.id;

  const terminalStatus = resolveTerminalRunJobStatus({
    runStatus: runtime.runStatus,
    isCompleted: runtime.completedJobs.has(job.id),
    isFailed: runtime.failedJobs.has(job.id),
    isCurrentJob,
  });
  if (terminalStatus) {
    return terminalStatus;
  }

  const activeStatus = resolveActiveRunJobStatus({
    runStatus: runtime.runStatus,
    isCurrentJob,
    hasOutstandingQuestion: runtime.hasOutstandingQuestion,
    isQueued: runtime.queuedJobs.has(job.id),
  });
  if (activeStatus) {
    return activeStatus;
  }

  if (
    runtime.runStatus &&
    runtime.runStatus !== WorkflowStatus.COMPLETED &&
    runtime.runStatus !== WorkflowStatus.FAILED &&
    runtime.runStatus !== WorkflowStatus.CANCELLED &&
    hasUnmetDependencies(job, runtime.completedJobs)
  ) {
    return 'blocked';
  }

  return 'idle';
}

const STEP_STATUS_BY_JOB_STATUS: Partial<
  Record<WorkflowNodeRuntimeStatus, WorkflowNodeRuntimeStatus>
> = {
  succeeded: 'succeeded',
  cancelled: 'cancelled',
  skipped: 'skipped',
  blocked: 'blocked',
  queued: 'queued',
  idle: 'idle',
};

export function resolveStepStatusFallback(params: {
  jobStatus: WorkflowNodeRuntimeStatus;
  stepCount: number;
  stepIndex: number;
}): WorkflowNodeRuntimeStatus {
  const { jobStatus, stepCount, stepIndex } = params;

  if (jobStatus === 'waiting_input') {
    return stepIndex === 0 ? 'waiting_input' : 'queued';
  }

  if (jobStatus === 'running') {
    return stepIndex === 0 ? 'running' : 'queued';
  }

  if (jobStatus === 'failed') {
    return stepCount === 1 || stepIndex === stepCount - 1 ? 'failed' : 'queued';
  }

  return STEP_STATUS_BY_JOB_STATUS[jobStatus] ?? 'idle';
}

export function findLatestEventTimestamp(
  events: WorkflowEvent[],
): string | null {
  return toIsoTimestamp(events.at(-1)?.timestamp);
}

export function hasOutstandingQuestion(events: WorkflowEvent[]): boolean {
  const latestQuestionEvent = events.findLast(
    (event) => event.event_type === 'user_questions_posed',
  );
  const latestAnswerEvent = events.findLast(
    (event) => event.event_type === 'user_question_answers',
  );

  const askedAt = toIsoTimestamp(latestQuestionEvent?.timestamp);
  const answeredAt = toIsoTimestamp(latestAnswerEvent?.timestamp);

  if (!askedAt) {
    return false;
  }

  if (!answeredAt) {
    return true;
  }

  return new Date(askedAt).getTime() > new Date(answeredAt).getTime();
}

export function createGraphResult(params: {
  nodes: WorkflowGraphNodeDto[];
  edges: WorkflowGraphEdgeDto[];
  statusBuckets: StatusBuckets;
}): Pick<
  WorkflowRunGraphDto,
  | 'nodes'
  | 'edges'
  | 'activeNodeIds'
  | 'queuedNodeIds'
  | 'completedNodeIds'
  | 'failedNodeIds'
> {
  const { nodes, edges, statusBuckets } = params;

  return {
    nodes,
    edges,
    activeNodeIds: statusBuckets.activeNodeIds,
    queuedNodeIds: statusBuckets.queuedNodeIds,
    completedNodeIds: statusBuckets.completedNodeIds,
    failedNodeIds: statusBuckets.failedNodeIds,
  };
}
