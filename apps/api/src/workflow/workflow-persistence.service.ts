import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { WorkflowRepositoryAggregator } from './workflow-repository-aggregator.service';
import { WorkflowParserService } from './workflow-parser.service';
import { WorkflowValidationService } from './workflow-validation.service';
import { YAMLValidationService } from '../security/yaml-validation.service';
import { isRecord, WorkflowStatus } from '@nexus/core';
import type {
  IWorkflow,
  IWorkflowRun,
  PaginationQueryRequest,
  RunningWorkflowSummary,
} from '@nexus/core';
import { buildRunStatusTimestampPatch } from './workflow-run-status-timestamps.helper';
import { mapRunningWorkflowSummaries } from './workflow-runtime/running-workflows.helpers';
import type { WorkflowRun } from './database/entities/workflow-run.entity';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { IWorkflowPersistenceService } from './kernel/interfaces/workflow-kernel.ports';
import { GitOpsEditPolicyService } from '../gitops/gitops-edit-policy.service';
import { GitOpsPendingChangeService } from '../gitops/gitops-pending-change.service';

type WorkflowRunDisplayItem = IWorkflowRun & {
  display_name: string;
  workflow_name: string | null;
  source_type?: 'seed' | 'user' | 'repository';
};

function getTriggerDisplayName(run: IWorkflowRun): string | null {
  const trigger = run.state_variables.trigger;
  if (!isRecord(trigger)) {
    return null;
  }

  const candidate = trigger.displayName ?? trigger.display_name;
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate.trim()
    : null;
}

function resolveWorkflowRunDisplayName(
  run: IWorkflowRun,
  workflowName: string | null,
): string {
  return (
    getTriggerDisplayName(run) ??
    workflowName ??
    `Workflow run ${run.id.slice(0, 8)}`
  );
}

@Injectable()
export class WorkflowPersistenceService implements IWorkflowPersistenceService {
  constructor(
    private readonly repos: WorkflowRepositoryAggregator,
    private readonly parser: WorkflowParserService,
    private readonly validator: WorkflowValidationService,
    private readonly yamlValidator: YAMLValidationService,
    @Optional()
    private readonly gitOpsEditPolicy?: GitOpsEditPolicyService,
    @Optional()
    private readonly gitOpsPendingChanges?: GitOpsPendingChangeService,
  ) {}

  async createWorkflow(yamlDefinition: string): Promise<IWorkflow> {
    this.yamlValidator.validateAndThrow(yamlDefinition);
    const def = this.parser.parseWorkflow(yamlDefinition);
    await this.validator.validateAndThrow(def);

    return this.repos.workflows.create({
      name: def.name,
      yaml_definition: yamlDefinition,
      is_active: true,
    });
  }

  async getWorkflow(id: string): Promise<IWorkflow> {
    const wf = await this.repos.workflows.findByIdentifier(id, {
      includeInactive: true,
    });
    if (!wf) throw new NotFoundException(`Workflow ${id} not found`);
    return wf;
  }

  async getAllWorkflows(options?: {
    includeInactive?: boolean;
  }): Promise<IWorkflow[]> {
    return this.repos.workflows.findAll(options);
  }

  async getAllWorkflowsPaged(
    pagination: { limit: number; offset: number },
    options?: {
      includeInactive?: boolean;
      isActive?: boolean;
      search?: string;
      sourceType?: string;
      sortBy?: PaginationQueryRequest['sortBy'];
      sortDir?: 'asc' | 'desc';
      scopeIds?: string[];
    },
  ): Promise<{ data: IWorkflow[]; total: number }> {
    // An empty scopeIds list does NOT mean "no results": platform/global
    // (NULL-scoped) workflows remain visible to any workflows:read holder.
    // The repository handles the NULL-inclusive filtering.
    return this.repos.workflows.findPaged(pagination, options);
  }

  async getWorkflowRuns(filters?: { workflowId?: string; scopeId?: string }) {
    const workflowId = await this.normalizeWorkflowRunFilterWorkflowId(
      filters?.workflowId,
    );
    const scopeId = filters?.scopeId;

    if (workflowId && scopeId) {
      return this.repos.runs.findByWorkflowAndScopeId(workflowId, scopeId);
    }

    if (workflowId) {
      return this.repos.runs.findByWorkflowId(workflowId);
    }

    if (scopeId) {
      return this.repos.runs.findByScopeId(scopeId);
    }

    return this.repos.runs.findAll();
  }

  async getActiveWorkflowRunsByScopeId(
    scopeId: string,
  ): Promise<IWorkflowRun[]> {
    return this.repos.runs.findActiveByScopeId(scopeId);
  }

  async getRunningWorkflowSummariesByScopeId(
    scopeId: string,
    options?: { excludeRunId?: string; limit?: number },
  ): Promise<RunningWorkflowSummary[]> {
    const runs = await this.repos.runs.findActiveByScopeId(scopeId);
    const workflowIds = Array.from(
      new Set(runs.map((run) => run.workflow_id).filter(Boolean)),
    );
    const namesById = new Map(
      (await this.repos.workflows.findByIds(workflowIds)).map((workflow) => [
        workflow.id,
        workflow.name,
      ]),
    );

    return mapRunningWorkflowSummaries(runs, namesById, Date.now(), options);
  }

  async getWorkflowRunsPaged(
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
  ): Promise<{ data: IWorkflowRun[]; total: number }> {
    const workflowId = await this.normalizeWorkflowRunFilterWorkflowId(
      filters?.workflowId,
    );

    const runs = await this.repos.runs.findPaged(pagination, {
      ...filters,
      ...(workflowId ? { workflowId } : {}),
    });

    return {
      ...runs,
      data: await this.enrichWorkflowRunDisplayNames(runs.data),
    };
  }

  private async enrichWorkflowRunDisplayNames(
    runs: IWorkflowRun[],
  ): Promise<WorkflowRunDisplayItem[]> {
    const workflowIds = Array.from(
      new Set(runs.map((run) => run.workflow_id).filter(Boolean)),
    );
    const workflowsById = new Map(
      (await this.repos.workflows.findByIds(workflowIds)).map((workflow) => [
        workflow.id,
        workflow,
      ]),
    );

    return runs.map((run): WorkflowRunDisplayItem => {
      const workflow = workflowsById.get(run.workflow_id);
      const workflowName = workflow?.name ?? null;
      return {
        ...run,
        workflow_name: workflowName,
        source_type: workflow?.source_type,
        display_name: resolveWorkflowRunDisplayName(run, workflowName),
      };
    });
  }

  private async normalizeWorkflowRunFilterWorkflowId(
    workflowId: string | undefined,
  ): Promise<string | undefined> {
    if (!workflowId) {
      return undefined;
    }

    const workflow = await this.repos.workflows.findByIdentifier(workflowId, {
      includeInactive: true,
    });
    return workflow?.id ?? workflowId;
  }

  async getWorkflowRun(runId: string): Promise<IWorkflowRun> {
    const run = await this.repos.runs.findById(runId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }
    const [enrichedRun] = await this.enrichWorkflowRunDisplayNames([run]);
    return enrichedRun;
  }

  async createRun(data: Partial<WorkflowRun>): Promise<IWorkflowRun> {
    const seeded: Partial<WorkflowRun> =
      data.status === WorkflowStatus.RUNNING && !data.started_at
        ? { ...data, started_at: new Date() }
        : data;
    return this.repos.runs.create(seeded);
  }

  async updateRun(
    id: string,
    data: QueryDeepPartialEntity<WorkflowRun>,
  ): Promise<void> {
    await this.repos.runs.update(id, data);
  }

  /**
   * Loads the run, applies the status transition and any timestamp patch,
   * and persists the changed status and timestamp fields.
   */
  async updateRunStatus(
    id: string,
    status: WorkflowStatus,
  ): Promise<WorkflowRun> {
    const run = await this.repos.runs.findById(id);
    if (!run) {
      throw new NotFoundException(`Workflow run ${id} not found`);
    }
    const timestampPatch = buildRunStatusTimestampPatch(
      run,
      status,
      new Date(),
    );
    run.status = status;
    await this.repos.runs.update(id, { status, ...timestampPatch });
    return run;
  }

  async updateWorkflow(
    id: string,
    yamlDefinition: string,
    actorId?: string,
  ): Promise<IWorkflow | null> {
    this.yamlValidator.validateAndThrow(yamlDefinition);
    const def = this.parser.parseWorkflow(yamlDefinition);
    await this.validator.validateAndThrow(def);

    const existing = await this.loadWorkflowForGitOpsPolicy(id);
    const decision = existing
      ? await this.evaluateExistingWorkflowEdit(existing)
      : undefined;
    const editDecision = decision ?? { action: 'allow' as const };
    this.gitOpsEditPolicy?.assertAllowed(editDecision);

    const updated = await this.repos.workflows.update(id, {
      name: def.name,
      yaml_definition: yamlDefinition,
    });
    await this.recordWorkflowPendingChange(
      editDecision,
      existing,
      def.name,
      {
        yaml_definition: yamlDefinition,
      },
      actorId,
      'update',
    );
    return updated;
  }

  async deleteWorkflow(id: string, actorId?: string): Promise<void> {
    const existing = await this.loadWorkflowForGitOpsPolicy(id);
    const decision = existing
      ? await this.evaluateExistingWorkflowEdit(existing)
      : undefined;
    const editDecision = decision ?? { action: 'allow' as const };
    this.gitOpsEditPolicy?.assertAllowed(editDecision);
    await this.repos.workflows.update(id, { is_active: false });
    await this.recordWorkflowPendingChange(
      editDecision,
      existing,
      this.getStringField(existing, 'name') ?? id,
      { is_active: false },
      actorId,
      'delete',
    );
  }

  async createScopedOverride(
    baseWorkflowId: string,
    scopeNodeId: string,
    yamlDefinition: string,
    actorId?: string,
  ): Promise<IWorkflow> {
    this.yamlValidator.validateAndThrow(yamlDefinition);
    const def = this.parser.parseWorkflow(yamlDefinition);
    await this.validator.validateAndThrow(def);

    const decision = await this.gitOpsEditPolicy?.evaluateCreate({
      objectType: 'workflow',
      scopeNodeId,
    });
    if (decision) {
      this.gitOpsEditPolicy?.assertAllowed(decision);
    }

    const created = await this.repos.workflows.create({
      name: def.name,
      yaml_definition: yamlDefinition,
      is_active: true,
      scope_node_id: scopeNodeId,
      base_workflow_id: baseWorkflowId,
    });
    await this.recordWorkflowPendingChange(
      decision ?? { action: 'allow' },
      created,
      def.name,
      { yaml_definition: yamlDefinition },
      actorId,
      'create',
    );
    return created;
  }

  async findWorkflowsByName(name: string): Promise<IWorkflow[]> {
    return this.repos.workflows.findByName(name);
  }

  private async loadWorkflowForGitOpsPolicy(
    id: string,
  ): Promise<Record<string, unknown> | null> {
    if (!this.gitOpsEditPolicy) {
      return null;
    }

    const workflow = await this.repos.workflows.findById(id);
    return workflow ? (workflow as unknown as Record<string, unknown>) : null;
  }

  private async evaluateExistingWorkflowEdit(
    workflow: Record<string, unknown>,
  ) {
    return this.gitOpsEditPolicy?.evaluateExisting({
      objectType: 'workflow',
      managedBy: this.getStringField(workflow, 'managedBy', 'managed_by'),
      managedBindingId: this.getStringField(
        workflow,
        'managedBindingId',
        'managed_binding_id',
      ),
      locked: this.getBooleanField(workflow, 'locked'),
    });
  }

  private async recordWorkflowPendingChange(
    decision: { action: string; binding?: unknown },
    workflow: Record<string, unknown> | IWorkflow | null,
    name: string,
    payload: Record<string, unknown>,
    actorId: string | undefined,
    changeType: string,
  ): Promise<void> {
    if (
      decision.action !== 'allow_with_pending_change' ||
      !decision.binding ||
      !this.gitOpsPendingChanges
    ) {
      return;
    }

    const scopeNodeId = this.getStringField(
      workflow as Record<string, unknown> | null,
      'scope_node_id',
      'scopeNodeId',
    );
    if (!scopeNodeId) {
      return;
    }

    await this.gitOpsPendingChanges.recordConfigObjectChange({
      binding: decision.binding as Parameters<
        GitOpsPendingChangeService['recordConfigObjectChange']
      >[0]['binding'],
      objectType: 'workflow',
      scopeNodeId,
      name,
      changeType,
      payload,
      actorId,
    });
  }

  private getStringField(
    value: Record<string, unknown> | null,
    ...keys: string[]
  ): string | null {
    for (const key of keys) {
      const candidate = value?.[key];
      if (typeof candidate === 'string') {
        return candidate;
      }
    }
    return null;
  }

  private getBooleanField(
    value: Record<string, unknown>,
    key: string,
  ): boolean {
    return value[key] === true;
  }
}
