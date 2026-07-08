import type {
  IWorkflow,
  IWorkflowRun,
  IWorkflowDefinition,
  IJob,
  IToolPermissionPolicy,
  PaginationQueryRequest,
  RunningWorkflowSummary,
  SkillDiscoveryMode,
  WaitReason,
  WorkflowStatus,
  HarnessSessionRef,
} from '@nexus/core';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { Workflow } from '../../database/entities/workflow.entity';
import type { WorkflowSourceType } from '../../database/entities/workflow.entity.types';
import type { WorkflowRun } from '../../database/entities/workflow-run.entity';
import type {
  StartWorkflowOptions,
  TriggerDedupeContext,
  WorkflowDryRunResult,
} from '../../workflow-engine.types';

export const WORKFLOW_ENGINE_SERVICE = 'WORKFLOW_ENGINE_SERVICE';
export const WORKFLOW_PARSER_SERVICE = 'WORKFLOW_PARSER_SERVICE';
export const STATE_MACHINE_SERVICE = 'STATE_MACHINE_SERVICE';
export const WORKFLOW_PERSISTENCE_SERVICE = 'WORKFLOW_PERSISTENCE_SERVICE';
export const WORKFLOW_RUNTIME_CAPABILITY_EXECUTOR_SERVICE =
  'WORKFLOW_RUNTIME_CAPABILITY_EXECUTOR_SERVICE';
export const WORKFLOW_RUNTIME_TOOLS_SERVICE = 'WORKFLOW_RUNTIME_TOOLS_SERVICE';
export const WORKFLOW_CANCELLATION_CASCADE_SERVICE =
  'WORKFLOW_CANCELLATION_CASCADE_SERVICE';
export const WORKFLOW_RUN_REPOSITORY_PORT = 'WORKFLOW_RUN_REPOSITORY_PORT';
export const WORKFLOW_DEFINITION_REPOSITORY_PORT =
  'WORKFLOW_DEFINITION_REPOSITORY_PORT';

export interface IWorkflowEngineService {
  startWorkflow(
    workflowId: string,
    triggerData: Record<string, unknown>,
    options: StartWorkflowOptions & { dryRun: true },
  ): Promise<WorkflowDryRunResult>;
  startWorkflow(
    workflowId: string,
    triggerData: Record<string, unknown>,
    options?: StartWorkflowOptions,
  ): Promise<string | null>;
  cancelWorkflowRun(runId: string, reason?: string): Promise<void>;
  handleJobComplete(
    workflowRunId: string,
    jobId: string,
    output: Record<string, unknown>,
  ): Promise<void>;
  resumeJobWithMessage(
    workflowRunId: string,
    sessionTreeId: string,
    userMessage: string,
    options?: { jobId?: string; resumeSessionRef?: HarnessSessionRef },
  ): Promise<string>;
  resumeWorkflow(workflowRunId: string): Promise<void>;
  retryJobWithMessage(
    workflowRunId: string,
    jobId: string,
    job: IJob,
    sessionTreeId: string | undefined,
    retryPrompt: string,
    workflowPermissions?: IToolPermissionPolicy,
    workflowSkillDiscoveryMode?: SkillDiscoveryMode,
    workflowYamlSkills?: string[],
  ): Promise<void>;
}

export interface IWorkflowParserService {
  parseWorkflow(yamlDefinition: string): IWorkflowDefinition;
  parse(yamlDefinition: string): IWorkflowDefinition;
}

export interface IStateMachineService {
  transition(state: WorkflowStatus, action: string): WorkflowStatus;
}

export interface IWorkflowPersistenceService {
  createWorkflow(yamlDefinition: string): Promise<IWorkflow>;
  getWorkflow(id: string): Promise<IWorkflow>;
  getAllWorkflows(options?: {
    includeInactive?: boolean;
  }): Promise<IWorkflow[]>;
  getAllWorkflowsPaged(
    pagination: { limit: number; offset: number },
    options?: {
      includeInactive?: boolean;
      isActive?: boolean;
      search?: string;
      sortBy?: PaginationQueryRequest['sortBy'];
      sortDir?: 'asc' | 'desc';
      scopeIds?: string[];
    },
  ): Promise<{ data: IWorkflow[]; total: number }>;
  getWorkflowRuns(filters?: {
    workflowId?: string;
    scopeId?: string;
  }): Promise<IWorkflowRun[]>;
  getWorkflowRunsPaged(
    pagination: { limit: number; offset: number },
    filters?: {
      workflowId?: string;
      scopeId?: string;
      contextId?: string;
      status?: string;
      search?: string;
      sourceType?: string;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
    },
  ): Promise<{ data: IWorkflowRun[]; total: number }>;
  getWorkflowRun(runId: string): Promise<IWorkflowRun>;
  getActiveWorkflowRunsByScopeId(
    scopeId: string,
  ): Promise<Array<{ id: string }>>;
  getRunningWorkflowSummariesByScopeId(
    scopeId: string,
    options?: { excludeRunId?: string; limit?: number },
  ): Promise<RunningWorkflowSummary[]>;
  updateWorkflow(
    id: string,
    yamlDefinition: string,
    actorId?: string,
  ): Promise<IWorkflow | null>;
  deleteWorkflow(id: string, actorId?: string): Promise<void>;
  createScopedOverride(
    baseWorkflowId: string,
    scopeNodeId: string,
    yamlDefinition: string,
    actorId?: string,
  ): Promise<IWorkflow>;
  findWorkflowsByName(name: string): Promise<IWorkflow[]>;
}

export interface IWorkflowRuntimeCapabilityExecutorService {
  executeRuntimeCapability(...args: unknown[]): Promise<unknown>;
}

export interface IWorkflowRuntimeToolsService {
  getCapabilities(...args: unknown[]): Promise<Record<string, unknown>>;
}

/**
 * Public contract for the iterative-BFS cascade cancellation seam.
 * Consumers (notably the engine) inject the `WORKFLOW_CANCELLATION_CASCADE_SERVICE`
 * token rather than the concrete `WorkflowCancellationCascadeService`
 * class so kernel modules can rebind the implementation without touching
 * call sites.
 */
export interface IWorkflowCancellationCascadeService {
  /**
   * Cancel `runId` and every active descendant run discovered via
   * iterative BFS. Terminal-status nodes (CANCELLED / COMPLETED /
   * FAILED) are skipped without side effects. Container kill, status
   * update, cancelled-event emission, and queued-job purge are
   * performed for each non-terminal node along the way.
   */
  cancelRun(runId: string, reason: string): Promise<void>;
}

/**
 * Public contract for the `WorkflowRunRepository` kernel seam.
 *
 * Cross-module consumers (operations/, automation/, docker/, war-room/,
 * and other workflow-adjacent modules) inject the
 * `WORKFLOW_RUN_REPOSITORY_PORT` token instead of importing the concrete
 * `WorkflowRunRepository` class directly. The interface mirrors the
 * concrete class's public surface so that any rebinding of the token
 * (test stub, alternative persistence, etc.) is a drop-in replacement
 * without touching call sites.
 */
export interface IWorkflowRunRepository {
  findAll(): Promise<WorkflowRun[]>;
  findById(id: string): Promise<WorkflowRun | null>;
  findByWorkflowId(workflow_id: string): Promise<WorkflowRun[]>;
  findByScopeId(scopeId: string): Promise<WorkflowRun[]>;
  findActiveByScopeId(scopeId: string): Promise<WorkflowRun[]>;
  findByWorkflowAndScopeId(
    workflowId: string,
    scopeId: string,
  ): Promise<WorkflowRun[]>;
  findActiveByProjectAndOrchestration(
    scopeId: string,
    orchestrationId: string,
  ): Promise<WorkflowRun[]>;
  findActiveByWorkflowProjectAndOrchestration(
    workflowId: string,
    scopeId: string,
    orchestrationId: string,
  ): Promise<WorkflowRun | null>;
  findPaged(
    pagination: { limit: number; offset: number },
    filters?: {
      workflowId?: string;
      scopeId?: string;
      contextId?: string;
      status?: string;
      search?: string;
      sourceType?: string;
    },
  ): Promise<{ data: WorkflowRun[]; total: number }>;
  findByStatus(status: WorkflowStatus): Promise<WorkflowRun[]>;
  findByIds(ids: string[]): Promise<WorkflowRun[]>;
  findActiveByTriggerContext(
    workflowId: string,
    trigger: TriggerDedupeContext,
  ): Promise<WorkflowRun | null>;
  findLatestByWorkflowAndDedupeKey(
    workflowId: string,
    dedupeKey: string,
  ): Promise<WorkflowRun | null>;
  countActiveByScope(
    workflowId: string,
    concurrencyScope: string,
  ): Promise<number>;
  findOldestPendingByScope(
    workflowId: string,
    concurrencyScope: string,
  ): Promise<WorkflowRun | null>;
  findPendingByScopeAndTrigger(
    workflowId: string,
    concurrencyScope: string,
    triggerData: Record<string, unknown>,
  ): Promise<WorkflowRun | null>;
  findPendingByScopeAndDedupeKey(
    workflowId: string,
    concurrencyScope: string,
    dedupeKey: string,
  ): Promise<WorkflowRun | null>;
  findOldestRunningByScope(
    workflowId: string,
    concurrencyScope: string,
  ): Promise<WorkflowRun | null>;
  create(data: Partial<WorkflowRun>): Promise<WorkflowRun>;
  update(
    id: string,
    data: QueryDeepPartialEntity<WorkflowRun>,
  ): Promise<WorkflowRun | null>;
  touch(id: string): Promise<void>;
  setAwaitingInput(id: string, awaitingInput: boolean): Promise<void>;
  setWaitState(runId: string, reason: WaitReason): Promise<void>;
  clearWaitState(runId: string): Promise<void>;
  tryMarkJobQueued(id: string, jobId: string): Promise<boolean>;
  tryMarkJobCompleted(id: string, jobId: string): Promise<boolean>;
  setStateVariableAtomic(
    id: string,
    dotPath: string,
    value: unknown,
  ): Promise<void>;
  deleteStateVariableAtomic(id: string, dotPath: string): Promise<void>;
  findActiveChildRunForParentStep(
    parentWorkflowRunId: string,
    parentStepId: string,
  ): Promise<WorkflowRun | null>;
  findActiveChildRunsForParentRun(
    parentWorkflowRunId: string,
  ): Promise<WorkflowRun[]>;
  findAdHocSessions(filters: {
    scopeId?: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<WorkflowRun[]>;
}

/**
 * Public contract for the `WorkflowRepository` kernel seam (manages
 * the workflow *definition* entity — the `Workflow` row holding the
 * `yaml_definition`).
 *
 * Cross-module consumers (operations/, automation/, docker/, war-room/,
 * and other workflow-adjacent modules) inject the
 * `WORKFLOW_DEFINITION_REPOSITORY_PORT` token instead of importing the
 * concrete `WorkflowRepository` class directly. The interface mirrors
 * the concrete class's public surface so that any rebinding of the
 * token (test stub, alternative persistence, etc.) is a drop-in
 * replacement without touching call sites.
 */
export interface IWorkflowDefinitionRepository {
  findAll(options?: { includeInactive?: boolean }): Promise<Workflow[]>;
  findById(id: string): Promise<Workflow | null>;
  findByIds(ids: string[]): Promise<Workflow[]>;
  findByIdentifier(
    identifier: string,
    options?: { includeInactive?: boolean },
  ): Promise<Workflow | null>;
  findByIdentifierForScope(
    identifier: string,
    scopeId?: string,
  ): Promise<Workflow | null>;
  findActiveBySourceScope(
    sourceType: WorkflowSourceType,
    scopeId: string,
  ): Promise<Workflow[]>;
  findActiveNonRepositoryByIdentifier(
    identifier: string,
  ): Promise<Workflow | null>;
  findRepositoryDefinitionByPath(
    scopeId: string,
    sourcePath: string,
  ): Promise<Workflow | null>;
  findPaged(
    pagination: { limit: number; offset: number },
    options?: Partial<
      Pick<
        PaginationQueryRequest,
        'includeInactive' | 'isActive' | 'search' | 'sortBy' | 'sortDir'
      >
    > & { scopeIds?: string[] },
  ): Promise<{ data: Workflow[]; total: number }>;
  findByName(name: string): Promise<Workflow[]>;
  create(data: Partial<Workflow>): Promise<Workflow>;
  update(id: string, data: Partial<Workflow>): Promise<Workflow | null>;
  remove(id: string): Promise<void>;
  deactivateByIds(ids: string[]): Promise<void>;
}
