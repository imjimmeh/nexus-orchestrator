import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { WorkflowEvent } from '../entities/workflow-event.entity';
import { WorkflowRun } from '../entities/workflow-run.entity';
import type {
  WorkflowEventPageFilters,
  WorkflowRunRequiredToolsAuditSummary,
} from './workflow-event.repository.types';

const WORKFLOW_EVENT_SORT_COLUMNS: Record<string, string> = {
  timestamp: 'event.timestamp',
  event_type: 'event.event_type',
  workflow_run_id: 'event.workflow_run_id',
};

@Injectable()
export class WorkflowEventRepository {
  constructor(
    @InjectRepository(WorkflowEvent)
    private readonly repository: Repository<WorkflowEvent>,
  ) {}

  async append(data: Partial<WorkflowEvent>): Promise<WorkflowEvent> {
    const entry = this.repository.create(data);
    return this.repository.save(entry);
  }

  async findByRunId(
    workflowRunId: string,
    limit = 100,
    offset = 0,
  ): Promise<[WorkflowEvent[], number]> {
    return this.repository.findAndCount({
      where: { workflow_run_id: workflowRunId },
      order: { timestamp: 'ASC' },
      take: limit,
      skip: offset,
    });
  }

  async findPaged(
    pagination: { limit: number; offset: number },
    filters: WorkflowEventPageFilters = {},
  ): Promise<[WorkflowEvent[], number]> {
    const queryBuilder = this.repository
      .createQueryBuilder('event')
      .leftJoin(WorkflowRun, 'run', 'run.id::text = event.workflow_run_id')
      .take(pagination.limit)
      .skip(pagination.offset);

    if (filters.scopeId) {
      queryBuilder.andWhere(
        "run.state_variables->'trigger'->>'scopeId' = :scopeId",
        {
          scopeId: filters.scopeId,
        },
      );
    }

    if (filters.eventTypes && filters.eventTypes.length > 0) {
      queryBuilder.andWhere('event.event_type IN (:...eventTypes)', {
        eventTypes: [...filters.eventTypes],
      });
    }

    if (filters.search) {
      queryBuilder.andWhere(
        new Brackets((searchBuilder) => {
          searchBuilder
            .where('event.event_type ILIKE :search', {
              search: `%${filters.search}%`,
            })
            .orWhere('event.workflow_run_id ILIKE :search', {
              search: `%${filters.search}%`,
            })
            .orWhere('event.step_id ILIKE :search', {
              search: `%${filters.search}%`,
            })
            .orWhere('event.job_id ILIKE :search', {
              search: `%${filters.search}%`,
            })
            .orWhere('event.actor_id ILIKE :search', {
              search: `%${filters.search}%`,
            })
            .orWhere('event.correlation_id ILIKE :search', {
              search: `%${filters.search}%`,
            });
        }),
      );
    }

    const sortColumn =
      WORKFLOW_EVENT_SORT_COLUMNS[filters.sortBy ?? 'timestamp'];
    queryBuilder.orderBy(
      sortColumn ?? WORKFLOW_EVENT_SORT_COLUMNS.timestamp,
      filters.sortDir === 'asc' ? 'ASC' : 'DESC',
    );

    return queryBuilder.getManyAndCount();
  }

  async findLatestQuestionEventsByRunIds(
    runIds: string[],
  ): Promise<WorkflowEvent[]> {
    if (runIds.length === 0) {
      return [];
    }

    const rowsUnknown: unknown = await this.repository.query(
      `
      SELECT DISTINCT ON (workflow_run_id) *
      FROM workflow_events
      WHERE workflow_run_id = ANY($1)
        AND event_type = 'user_questions_posed'
      ORDER BY workflow_run_id, timestamp DESC
    `,
      [runIds],
    );

    if (!Array.isArray(rowsUnknown)) {
      return [];
    }

    return rowsUnknown as WorkflowEvent[];
  }

  async getRequiredToolsAuditSummaryByRunId(
    workflowRunId: string,
  ): Promise<WorkflowRunRequiredToolsAuditSummary | null> {
    const rowsUnknown: unknown = await this.repository.query(
      `
        SELECT
          workflow_run_id,
          workflow_id,
          run_status,
          created_at,
          updated_at,
          scope_id,
          context_id,
          queued_jobs_count,
          queued_jobs_with_required_tools,
          required_tools_satisfied_count,
          required_tools_missing_count,
          required_tools_retry_enqueued_count,
          required_tools_exhausted_count,
          queued_job_audit,
          required_tool_events
        FROM workflow_run_required_tools_audit_v1
        WHERE workflow_run_id = $1::uuid
        LIMIT 1
      `,
      [workflowRunId],
    );

    if (!Array.isArray(rowsUnknown) || rowsUnknown.length === 0) {
      return null;
    }

    return rowsUnknown[0] as WorkflowRunRequiredToolsAuditSummary;
  }
}
