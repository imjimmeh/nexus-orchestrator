import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { PiSessionTree } from '../entities/pi-session-tree.entity';
import type { LearningSessionTreeSource } from './pi-session-tree.repository.types';

@Injectable()
export class PiSessionTreeRepository {
  constructor(
    @InjectRepository(PiSessionTree)
    private readonly repository: Repository<PiSessionTree>,
  ) {}

  async findAll(): Promise<PiSessionTree[]> {
    return this.repository.find();
  }

  async findActiveMetadataForCleanup(params: {
    skip: number;
    take: number;
  }): Promise<
    Array<Pick<PiSessionTree, 'id' | 'workflow_run_id' | 'created_at'>>
  > {
    return this.repository.find({
      select: {
        id: true,
        workflow_run_id: true,
        created_at: true,
      },
      where: {
        archived_at: IsNull(),
      },
      skip: params.skip,
      take: params.take,
      order: {
        created_at: 'ASC',
      },
    });
  }

  async findActiveOlderThan(cutoff: Date): Promise<PiSessionTree[]> {
    return this.repository.find({
      where: {
        archived_at: IsNull(),
        created_at: LessThan(cutoff),
      },
    });
  }

  async findRecentSuccessfulForLearning(params: {
    occurredAfter: Date;
    limit: number;
  }): Promise<LearningSessionTreeSource[]> {
    return this.repository
      .createQueryBuilder('tree')
      .leftJoin(
        'workflow_runs',
        'workflow_run',
        'workflow_run.id = tree.workflow_run_id',
      )
      .leftJoin(
        'chat_sessions',
        'chat_session',
        'chat_session.id = tree.chat_session_id',
      )
      .select([
        'tree.id AS id',
        'tree.workflow_run_id AS workflow_run_id',
        'tree.chat_session_id AS chat_session_id',
        'tree.jsonl_data AS jsonl_data',
        'tree.created_at AS created_at',
        'tree.updated_at AS updated_at',
        'workflow_run.status AS workflow_status',
        'chat_session.status AS chat_status',
        'chat_session.scope_id AS chat_scope_id',
      ])
      .where('tree.created_at >= :occurredAfter', {
        occurredAfter: params.occurredAfter,
      })
      .andWhere('tree.archived_at IS NULL')
      .andWhere(
        "(workflow_run.status = 'COMPLETED' OR chat_session.status = 'COMPLETED')",
      )
      .orderBy('tree.created_at', 'DESC')
      .limit(params.limit)
      .getRawMany<LearningSessionTreeSource>();
  }

  async findById(id: string): Promise<PiSessionTree | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByWorkflowRunId(
    workflow_run_id: string,
  ): Promise<PiSessionTree | null> {
    // A run can own multiple trees (across turns/distillation). Order
    // deterministically so callers always read the freshest tree rather than
    // an arbitrary one — durable-await resume injects child results into the
    // latest tree.
    return this.repository.findOne({
      where: { workflow_run_id },
      order: { updated_at: 'DESC', created_at: 'DESC' },
    });
  }

  async create(data: Partial<PiSessionTree>): Promise<PiSessionTree> {
    const tree = this.repository.create(data);
    return this.repository.save(tree);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<PiSessionTree>,
  ): Promise<PiSessionTree | null> {
    await this.repository.update(id, data);
    return this.repository.findOne({ where: { id } });
  }

  async archive(
    id: string,
    archiveReason: string,
  ): Promise<PiSessionTree | null> {
    await this.repository.update(id, {
      archived_at: new Date(),
      archive_reason: archiveReason,
    });

    return this.repository.findOne({ where: { id } });
  }
}
