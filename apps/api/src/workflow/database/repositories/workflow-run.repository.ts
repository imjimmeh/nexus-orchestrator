import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { WorkflowStatus } from '@nexus/core';
import type { WaitReason } from '@nexus/core';
import { WorkflowRun } from '../entities/workflow-run.entity';
import { buildNestedJsonbSetExpr } from './jsonb-state-expression.helpers';
import { stripNullBytesDeep } from '../../../common/utils/strip-null-bytes.util';
import {
  applyWorkflowRunSourceTypeFilter,
  ensureWorkflowDefinitionJoined,
} from './workflow-run-query.helpers';

const HUMAN_INPUT_WAIT_REASON: WaitReason = 'human_input';

/** JSONB path expressions for the `state_variables.trigger` sub-document. */
const TRIGGER = {
  SCOPE_ID: "wr.state_variables->'trigger'->>'scopeId'",
  ORCHESTRATION_ID: "wr.state_variables->'trigger'->>'orchestrationId'",
  EVENT: "wr.state_variables->'trigger'->>'event'",
  CONTEXT_ID: "wr.state_variables->'trigger'->>'contextId'",
  STATUS: "wr.state_variables->'trigger'->>'status'",
  DISPLAY_NAME: "wr.state_variables->'trigger'->>'displayName'",
  SOURCE: "wr.state_variables->'trigger'->>'source'",
  DEDUPE_KEY: "wr.state_variables->'trigger'->>'dedupeKey'",
  PAYLOAD_DEDUPE_KEY: "wr.state_variables->'trigger'->'payload'->>'dedupeKey'",
} as const;

const LAUNCH_DEDUPE_STATUSES = [
  WorkflowStatus.PENDING,
  WorkflowStatus.RUNNING,
  WorkflowStatus.COMPLETED,
] as const;

interface TriggerDedupeContext {
  event: string;
  scopeId: string;
  contextId: string;
  status: string;
}

@Injectable()
export class WorkflowRunRepository {
  constructor(
    @InjectRepository(WorkflowRun)
    private readonly repository: Repository<WorkflowRun>,
  ) {}

  async findAll(): Promise<WorkflowRun[]> {
    return this.repository.find({
      order: { created_at: 'DESC' },
    });
  }

  async findById(id: string): Promise<WorkflowRun | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByWorkflowId(workflow_id: string): Promise<WorkflowRun[]> {
    return this.repository.find({
      where: { workflow_id },
      order: { created_at: 'DESC' },
    });
  }

  async findByScopeId(scopeId: string): Promise<WorkflowRun[]> {
    return this.repository
      .createQueryBuilder('wr')
      .where(`${TRIGGER.SCOPE_ID} = :scopeId`, {
        scopeId,
      })
      .orderBy('wr.created_at', 'DESC')
      .getMany();
  }

  async findActiveByScopeId(scopeId: string): Promise<WorkflowRun[]> {
    return this.repository
      .createQueryBuilder('wr')
      .where('wr.status IN (:...activeStatuses)', {
        activeStatuses: [WorkflowStatus.PENDING, WorkflowStatus.RUNNING],
      })
      .andWhere(`${TRIGGER.SCOPE_ID} = :scopeId`, {
        scopeId,
      })
      .orderBy('wr.created_at', 'DESC')
      .getMany();
  }

  async findByWorkflowAndScopeId(
    workflowId: string,
    scopeId: string,
  ): Promise<WorkflowRun[]> {
    return this.repository
      .createQueryBuilder('wr')
      .where('wr.workflow_id = :workflowId', { workflowId })
      .andWhere(`${TRIGGER.SCOPE_ID} = :scopeId`, {
        scopeId,
      })
      .orderBy('wr.created_at', 'DESC')
      .getMany();
  }

  async findActiveByProjectAndOrchestration(
    scopeId: string,
    orchestrationId: string,
  ): Promise<WorkflowRun[]> {
    return this.repository
      .createQueryBuilder('wr')
      .where('wr.status IN (:...activeStatuses)', {
        activeStatuses: [WorkflowStatus.PENDING, WorkflowStatus.RUNNING],
      })
      .andWhere(`${TRIGGER.SCOPE_ID} = :scopeId`, {
        scopeId,
      })
      .andWhere(`${TRIGGER.ORCHESTRATION_ID} = :orchestrationId`, {
        orchestrationId,
      })
      .orderBy('wr.created_at', 'DESC')
      .getMany();
  }

  async findActiveByWorkflowProjectAndOrchestration(
    workflowId: string,
    scopeId: string,
    orchestrationId: string,
  ): Promise<WorkflowRun | null> {
    return this.repository
      .createQueryBuilder('wr')
      .where('wr.workflow_id = :workflowId', { workflowId })
      .andWhere('wr.status IN (:...activeStatuses)', {
        activeStatuses: [WorkflowStatus.PENDING, WorkflowStatus.RUNNING],
      })
      .andWhere(`${TRIGGER.SCOPE_ID} = :scopeId`, {
        scopeId,
      })
      .andWhere(`${TRIGGER.ORCHESTRATION_ID} = :orchestrationId`, {
        orchestrationId,
      })
      .orderBy('wr.created_at', 'DESC')
      .getOne();
  }

  async findPaged(
    pagination: { limit: number; offset: number },
    filters?: {
      workflowId?: string;
      scopeId?: string;
      contextId?: string;
      status?: string;
      search?: string;
      sourceType?: string;
    },
  ): Promise<{ data: WorkflowRun[]; total: number }> {
    const queryBuilder = this.repository
      .createQueryBuilder('wr')
      .orderBy('wr.created_at', 'DESC')
      .skip(pagination.offset)
      .take(pagination.limit);

    if (filters?.workflowId) {
      queryBuilder.andWhere('wr.workflow_id = :workflowId', {
        workflowId: filters.workflowId,
      });
    }

    if (filters?.scopeId) {
      queryBuilder.andWhere(`${TRIGGER.SCOPE_ID} = :scopeId`, {
        scopeId: filters.scopeId,
      });
    }

    if (filters?.contextId) {
      queryBuilder.andWhere(`${TRIGGER.CONTEXT_ID} = :contextId`, {
        contextId: filters.contextId,
      });
    }

    if (filters?.status) {
      const statuses = filters.status.split(',');
      if (statuses.length === 1) {
        queryBuilder.andWhere('wr.status = :status', {
          status: filters.status,
        });
      } else {
        queryBuilder.andWhere('wr.status IN (:...statuses)', { statuses });
      }
    }

    if (filters?.search) {
      ensureWorkflowDefinitionJoined(queryBuilder);
      queryBuilder.andWhere(
        `(w.name ILIKE :search OR (${TRIGGER.DISPLAY_NAME}) ILIKE :search OR wr.state_variables->'trigger'->>'display_name' ILIKE :search OR wr.id::text ILIKE :search)`,
        { search: `%${filters.search}%` },
      );
    }

    applyWorkflowRunSourceTypeFilter(queryBuilder, filters?.sourceType);

    const [data, total] = await queryBuilder.getManyAndCount();
    return { data, total };
  }

  async findByStatus(status: WorkflowStatus): Promise<WorkflowRun[]> {
    return this.repository.find({
      where: { status },
      order: { created_at: 'DESC' },
    });
  }

  async findByIds(ids: string[]): Promise<WorkflowRun[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.repository.find({
      where: {
        id: In(ids),
      },
    });
  }

  async findActiveByTriggerContext(
    workflowId: string,
    trigger: TriggerDedupeContext,
  ): Promise<WorkflowRun | null> {
    return this.repository
      .createQueryBuilder('wr')
      .where('wr.workflow_id = :workflowId', { workflowId })
      .andWhere('wr.status IN (:...activeStatuses)', {
        activeStatuses: [WorkflowStatus.PENDING, WorkflowStatus.RUNNING],
      })
      .andWhere(`${TRIGGER.EVENT} = :event`, {
        event: trigger.event,
      })
      .andWhere(`${TRIGGER.SCOPE_ID} = :scopeId`, {
        scopeId: trigger.scopeId,
      })
      .andWhere(`${TRIGGER.CONTEXT_ID} = :contextId`, {
        contextId: trigger.contextId,
      })
      .andWhere(`${TRIGGER.STATUS} = :status`, {
        status: trigger.status,
      })
      .orderBy('wr.created_at', 'DESC')
      .getOne();
  }

  async findLatestByWorkflowAndDedupeKey(
    workflowId: string,
    dedupeKey: string,
  ): Promise<WorkflowRun | null> {
    return this.repository
      .createQueryBuilder('wr')
      .where('wr.workflow_id = :workflowId', { workflowId })
      .andWhere('wr.status IN (:...statuses)', {
        statuses: LAUNCH_DEDUPE_STATUSES,
      })
      .andWhere(
        `(wr.launch_dedupe_key = :dedupeKey OR ${TRIGGER.DEDUPE_KEY} = :dedupeKey OR ${TRIGGER.PAYLOAD_DEDUPE_KEY} = :dedupeKey)`,
        { dedupeKey },
      )
      .orderBy('wr.created_at', 'DESC')
      .getOne();
  }

  async countActiveByScope(
    workflowId: string,
    concurrencyScope: string,
  ): Promise<number> {
    return this.repository.count({
      where: {
        workflow_id: workflowId,
        concurrency_scope: concurrencyScope,
        status: In([WorkflowStatus.PENDING, WorkflowStatus.RUNNING]),
      },
    });
  }

  async findOldestPendingByScope(
    workflowId: string,
    concurrencyScope: string,
  ): Promise<WorkflowRun | null> {
    return this.repository.findOne({
      where: {
        workflow_id: workflowId,
        concurrency_scope: concurrencyScope,
        status: WorkflowStatus.PENDING,
      },
      order: { created_at: 'ASC' },
    });
  }

  async findPendingByScopeAndTrigger(
    workflowId: string,
    concurrencyScope: string,
    triggerData: Record<string, unknown>,
  ): Promise<WorkflowRun | null> {
    return this.repository
      .createQueryBuilder('wr')
      .where('wr.workflow_id = :workflowId', { workflowId })
      .andWhere('wr.concurrency_scope = :concurrencyScope', {
        concurrencyScope,
      })
      .andWhere('wr.status = :status', { status: WorkflowStatus.PENDING })
      .andWhere("wr.state_variables->'trigger' = CAST(:triggerData AS jsonb)", {
        triggerData: JSON.stringify(triggerData),
      })
      .orderBy('wr.created_at', 'ASC')
      .getOne();
  }

  async findPendingByScopeAndDedupeKey(
    workflowId: string,
    concurrencyScope: string,
    dedupeKey: string,
  ): Promise<WorkflowRun | null> {
    return this.repository
      .createQueryBuilder('wr')
      .where('wr.workflow_id = :workflowId', { workflowId })
      .andWhere('wr.concurrency_scope = :concurrencyScope', {
        concurrencyScope,
      })
      .andWhere('wr.status = :status', { status: WorkflowStatus.PENDING })
      .andWhere(
        `(wr.launch_dedupe_key = :dedupeKey OR ${TRIGGER.DEDUPE_KEY} = :dedupeKey)`,
        {
          dedupeKey,
        },
      )
      .orderBy('wr.created_at', 'ASC')
      .getOne();
  }

  async findOldestRunningByScope(
    workflowId: string,
    concurrencyScope: string,
  ): Promise<WorkflowRun | null> {
    return this.repository.findOne({
      where: {
        workflow_id: workflowId,
        concurrency_scope: concurrencyScope,
        status: WorkflowStatus.RUNNING,
      },
      order: { created_at: 'ASC' },
    });
  }

  async create(data: Partial<WorkflowRun>): Promise<WorkflowRun> {
    const run = this.repository.create(data);
    return this.repository.save(run);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<WorkflowRun>,
  ): Promise<WorkflowRun | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async touch(id: string): Promise<void> {
    await this.repository.update(id, { updated_at: new Date() });
  }

  async setAwaitingInput(id: string, awaitingInput: boolean): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(WorkflowRun)
      .set({ awaiting_input: awaitingInput })
      .where('id = :id', { id })
      .andWhere('status = :status', { status: WorkflowStatus.RUNNING })
      .execute();
  }

  async setWaitState(runId: string, reason: WaitReason): Promise<void> {
    const set: QueryDeepPartialEntity<WorkflowRun> =
      reason === HUMAN_INPUT_WAIT_REASON
        ? { wait_reason: reason, awaiting_input: true }
        : { wait_reason: reason };

    await this.repository
      .createQueryBuilder()
      .update(WorkflowRun)
      .set(set)
      .where('id = :id', { id: runId })
      .andWhere('status = :status', { status: WorkflowStatus.RUNNING })
      .execute();
  }

  async clearWaitState(runId: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(WorkflowRun)
      .set({ wait_reason: null, awaiting_input: false })
      .where('id = :id', { id: runId })
      .execute();
  }

  tryMarkJobQueued(id: string, jobId: string): Promise<boolean> {
    return this.tryClaimInternalJobFlag(id, 'queued_jobs', jobId);
  }

  tryMarkJobCompleted(id: string, jobId: string): Promise<boolean> {
    return this.tryClaimInternalJobFlag(id, 'completed_jobs', jobId);
  }

  private async tryClaimInternalJobFlag(
    id: string,
    flagGroup: 'queued_jobs' | 'completed_jobs',
    jobId: string,
  ): Promise<boolean> {
    const params: Record<string, string> = {};
    const expr = buildNestedJsonbSetExpr({
      segments: ['_internal', flagGroup, jobId],
      leafValueSql: "'true'::jsonb",
      params,
    });

    const result = await this.repository
      .createQueryBuilder()
      .update(WorkflowRun)
      .set({
        state_variables: () => expr,
      })
      .where('id = :id', { id })
      .andWhere('status = :status', { status: WorkflowStatus.RUNNING })
      .andWhere(`COALESCE("state_variables" #>> :leafPath, 'false') != 'true'`)
      .setParameters({ ...params, id, status: WorkflowStatus.RUNNING })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async setStateVariableAtomic(
    id: string,
    dotPath: string,
    value: unknown,
  ): Promise<void> {
    const segments = dotPath.split('.');
    const params: Record<string, string> = {
      // Strip NUL (U+0000) before the ::jsonb cast: a single NUL anywhere in the
      // value — typically from raw Docker log frames captured into agent output —
      // aborts the UPDATE with "unsupported Unicode escape sequence" and wedges
      // the run in a retry loop. This is the persistence choke point every state
      // write passes through, so sanitizing here closes the gap the outbox
      // sanitizer cannot reach.
      val: JSON.stringify(stripNullBytesDeep(value)),
    };
    const expr = buildNestedJsonbSetExpr({
      segments,
      leafValueSql: ':val::jsonb',
      params,
    });

    await this.repository
      .createQueryBuilder()
      .update(WorkflowRun)
      .set({ state_variables: () => expr })
      .where('id = :id', { id })
      .setParameters(params)
      .execute();
  }

  async deleteStateVariableAtomic(id: string, dotPath: string): Promise<void> {
    const segments = dotPath.split('.');
    const pgPath = `{${segments.join(',')}}`;

    await this.repository
      .createQueryBuilder()
      .update(WorkflowRun)
      .set({
        state_variables: () =>
          `COALESCE("state_variables" #- CAST(:delPath AS text[]), '{}'::jsonb)`,
      })
      .where('id = :id', { id })
      .setParameters({ delPath: pgPath })
      .execute();
  }

  async findActiveChildRunForParentStep(
    parentWorkflowRunId: string,
    parentStepId: string,
  ): Promise<WorkflowRun | null> {
    return this.repository
      .createQueryBuilder('wr')
      .where('wr.status IN (:...activeStatuses)', {
        activeStatuses: [WorkflowStatus.PENDING, WorkflowStatus.RUNNING],
      })
      .andWhere(
        `wr.state_variables->'trigger'->>'parentWorkflowRunId' = :parentWorkflowRunId`,
        { parentWorkflowRunId },
      )
      .andWhere(
        `wr.state_variables->'trigger'->>'parentStepId' = :parentStepId`,
        { parentStepId },
      )
      .orderBy('wr.created_at', 'DESC')
      .getOne();
  }

  async findActiveChildRunsForParentRun(
    parentWorkflowRunId: string,
  ): Promise<WorkflowRun[]> {
    return this.repository
      .createQueryBuilder('wr')
      .where('wr.status IN (:...activeStatuses)', {
        activeStatuses: [WorkflowStatus.PENDING, WorkflowStatus.RUNNING],
      })
      .andWhere(
        `wr.state_variables->'trigger'->>'parentWorkflowRunId' = :parentWorkflowRunId`,
        { parentWorkflowRunId },
      )
      .orderBy('wr.created_at', 'DESC')
      .getMany();
  }

  async findAdHocSessions(filters: {
    scopeId?: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<WorkflowRun[]> {
    const qb = this.repository
      .createQueryBuilder('wr')
      .where(`${TRIGGER.SOURCE} = :source`, {
        source: 'ad-hoc',
      });

    if (filters.scopeId) {
      qb.andWhere(`${TRIGGER.SCOPE_ID} = :scopeId`, {
        scopeId: filters.scopeId,
      });
    }

    if (filters.status) {
      qb.andWhere('wr.status = :status', { status: filters.status });
    }

    return qb
      .orderBy('wr.created_at', 'DESC')
      .skip(filters.offset)
      .take(filters.limit)
      .getMany();
  }
}
