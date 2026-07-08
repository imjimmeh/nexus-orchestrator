import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  asRecord,
  getNestedValue,
  IJob,
  IWorkflowDefinition,
  WorkflowGraphEdge as WorkflowGraphEdgeDto,
  WorkflowGraphNode as WorkflowGraphNodeDto,
  WorkflowNodeRuntimeStatus,
  WorkflowRunGraphSnapshot as WorkflowRunGraphDto,
  WorkflowStatus,
} from '@nexus/core';
import { WorkflowEvent } from '../database/entities/workflow-event.entity';
import { WorkflowEventRepository } from '../database/repositories/workflow-event.repository';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_RUN_REPOSITORY_PORT,
} from '../kernel/interfaces/workflow-kernel.ports';
import type {
  IWorkflowDefinitionRepository,
  IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import {
  asBooleanMap,
  collectStatusNode,
  createGraphResult,
  createStatusBuckets,
  findLatestEventTimestamp,
  hasOutstandingQuestion,
  mapStepExecutionStatus,
  resolveJobStatus,
  resolveStepStatusFallback,
  toJobNodeId,
  toStepNodeId,
} from './workflow-graph-read-model.helpers';
import type { RuntimeContext } from './workflow-graph-read-model.types';
import { WorkflowParserService } from '../workflow-parser.service';

const MAX_GRAPH_EVENTS = 5000;

@Injectable()
export class WorkflowGraphReadModelService {
  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepo: IWorkflowDefinitionRepository,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly workflowRunRepo: IWorkflowRunRepository,
    private readonly workflowParser: WorkflowParserService,
    private readonly workflowEventRepo: WorkflowEventRepository,
  ) {}

  async getRunGraph(runId: string): Promise<WorkflowRunGraphDto> {
    const run = await this.workflowRunRepo.findById(runId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }

    const workflow = await this.workflowRepo.findByIdentifier(run.workflow_id, {
      includeInactive: true,
    });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${run.workflow_id} not found`);
    }

    const definition = this.workflowParser.parseWorkflow(
      workflow.yaml_definition,
    );
    const [events, totalEvents] = await this.workflowEventRepo.findByRunId(
      run.id,
      MAX_GRAPH_EVENTS,
      0,
    );

    return this.buildSnapshot({
      workflowId: workflow.id,
      definition,
      runId: run.id,
      runStatus: run.status,
      currentJobId: run.current_step_id ?? null,
      stateVariables: asRecord(run.state_variables),
      events,
      totalEvents,
    });
  }

  async getWorkflowGraph(workflowId: string): Promise<WorkflowRunGraphDto> {
    const workflow = await this.workflowRepo.findById(workflowId);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    const definition = this.workflowParser.parseWorkflow(
      workflow.yaml_definition,
    );

    return this.buildSnapshot({
      workflowId,
      definition,
      runId: null,
      runStatus: null,
      currentJobId: null,
      stateVariables: {},
      events: [],
      totalEvents: 0,
    });
  }

  private buildSnapshot(params: {
    workflowId: string;
    definition: IWorkflowDefinition;
    runId: string | null;
    runStatus: WorkflowStatus | null;
    currentJobId: string | null;
    stateVariables: Record<string, unknown>;
    events: WorkflowEvent[];
    totalEvents: number;
  }): WorkflowRunGraphDto {
    const jobs = params.definition.jobs ?? [];
    const runtime = this.buildRuntimeContext({
      runStatus: params.runStatus,
      currentJobId: params.currentJobId,
      stateVariables: params.stateVariables,
      events: params.events,
    });
    const graph = this.buildGraphFromJobs(jobs, params.stateVariables, runtime);

    return {
      workflowId: params.workflowId,
      workflowRunId: params.runId,
      runStatus: params.runStatus,
      ...graph,
      cursor: {
        latestEventAt: findLatestEventTimestamp(params.events),
        totalEvents: params.totalEvents,
      },
    };
  }

  private buildRuntimeContext(params: {
    runStatus: WorkflowStatus | null;
    currentJobId: string | null;
    stateVariables: Record<string, unknown>;
    events: WorkflowEvent[];
  }): RuntimeContext {
    const completedJobs = asBooleanMap(
      getNestedValue(
        params.stateVariables,
        '_internal.completed_jobs'.split('.'),
      ),
    );
    const queuedJobs = asBooleanMap(
      getNestedValue(params.stateVariables, '_internal.queued_jobs'.split('.')),
    );

    const failedJobs = new Set(
      params.events
        .filter(
          (event) =>
            event.event_type === 'job.failed' ||
            event.event_type === 'workflow.failed',
        )
        .map((event) => event.job_id)
        .filter((jobId): jobId is string => typeof jobId === 'string'),
    );

    return {
      runStatus: params.runStatus,
      currentJobId: params.currentJobId,
      completedJobs,
      queuedJobs,
      failedJobs,
      hasOutstandingQuestion: hasOutstandingQuestion(params.events),
    };
  }

  private buildGraphFromJobs(
    jobs: IJob[],
    stateVariables: Record<string, unknown>,
    runtime: RuntimeContext,
  ): Pick<
    WorkflowRunGraphDto,
    | 'nodes'
    | 'edges'
    | 'activeNodeIds'
    | 'queuedNodeIds'
    | 'completedNodeIds'
    | 'failedNodeIds'
  > {
    const nodes: WorkflowGraphNodeDto[] = [];
    const edges: WorkflowGraphEdgeDto[] = [];
    const statusBuckets = createStatusBuckets();

    for (const job of jobs) {
      const jobStatus = resolveJobStatus({ job, runtime });

      this.appendJobNodeAndSteps({
        job,
        jobStatus,
        stateVariables,
        nodes,
        edges,
        statusBuckets,
      });
      this.appendJobEdges(job, edges);
    }

    return createGraphResult({ nodes, edges, statusBuckets });
  }

  private appendJobNodeAndSteps(params: {
    job: IJob;
    jobStatus: WorkflowNodeRuntimeStatus;
    stateVariables: Record<string, unknown>;
    nodes: WorkflowGraphNodeDto[];
    edges: WorkflowGraphEdgeDto[];
    statusBuckets: ReturnType<typeof createStatusBuckets>;
  }): void {
    const { job, jobStatus, stateVariables, nodes, edges, statusBuckets } =
      params;
    const jobSteps = Array.isArray(job.steps) ? job.steps : [];

    const jobNodeId = toJobNodeId(job.id);
    nodes.push({
      id: jobNodeId,
      label: job.id,
      kind: 'job',
      status: jobStatus,
      jobId: job.id,
      metadata: {
        type: job.type,
        tier: job.tier,
        dependsOn: job.depends_on ?? [],
        stepCount: jobSteps.length,
      },
    });

    collectStatusNode(jobNodeId, jobStatus, statusBuckets);

    const stepState = asRecord(
      getNestedValue(stateVariables, `jobs.${job.id}.steps`.split('.')),
    );

    jobSteps.forEach((step, index) => {
      const explicitStatus = this.resolveStepStatusFromState(
        stepState,
        step.id,
      );
      const stepStatus =
        explicitStatus ??
        resolveStepStatusFallback({
          jobStatus,
          stepCount: jobSteps.length,
          stepIndex: index,
        });

      const stepNodeId = toStepNodeId(job.id, step.id);
      nodes.push({
        id: stepNodeId,
        label: step.id,
        kind: 'step',
        status: stepStatus,
        jobId: job.id,
        stepId: step.id,
        parentJobId: job.id,
        metadata: {
          type: step.type ?? 'agent',
        },
      });

      collectStatusNode(stepNodeId, stepStatus, statusBuckets);

      if (index === 0) {
        edges.push({
          id: `edge:contains:${job.id}:${step.id}`,
          source: jobNodeId,
          target: stepNodeId,
          kind: 'contains',
        });
      }

      if (index < jobSteps.length - 1) {
        const nextStepId = jobSteps[index + 1]?.id;
        if (nextStepId) {
          edges.push({
            id: `edge:sequence:${job.id}:${step.id}->${nextStepId}`,
            source: stepNodeId,
            target: toStepNodeId(job.id, nextStepId),
            kind: 'sequence',
          });
        }
      }
    });
  }

  private appendJobEdges(job: IJob, edges: WorkflowGraphEdgeDto[]): void {
    for (const dependencyId of job.depends_on ?? []) {
      edges.push({
        id: `edge:depends_on:${dependencyId}->${job.id}`,
        source: toJobNodeId(dependencyId),
        target: toJobNodeId(job.id),
        kind: 'depends_on',
      });
    }

    for (const transition of job.transitions ?? []) {
      edges.push({
        id: `edge:transition:${job.id}->${transition.next}`,
        source: toJobNodeId(job.id),
        target: toJobNodeId(transition.next),
        kind: 'transition',
      });
    }
  }

  private resolveStepStatusFromState(
    stepState: Record<string, unknown>,
    stepId: string,
  ): WorkflowNodeRuntimeStatus | null {
    const stateEntry = stepState[stepId];
    if (!stateEntry || typeof stateEntry !== 'object') {
      return null;
    }

    const status = (stateEntry as { status?: string }).status;
    return mapStepExecutionStatus(status);
  }
}
