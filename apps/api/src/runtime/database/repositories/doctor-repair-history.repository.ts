import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DoctorRepairHistoryStatus } from '../entities/doctor-repair-history.entity.types';
import { DoctorRepairHistory } from '../entities/doctor-repair-history.entity';

@Injectable()
export class DoctorRepairHistoryRepository {
  constructor(
    @InjectRepository(DoctorRepairHistory)
    private readonly repository: Repository<DoctorRepairHistory>,
  ) {}

  async createAttempt(data: {
    action_id: string;
    dry_run: boolean;
    requested_by?: string | null;
    input_json?: Record<string, unknown>;
  }): Promise<DoctorRepairHistory> {
    const entity = this.repository.create({
      action_id: data.action_id,
      dry_run: data.dry_run,
      requested_by: data.requested_by ?? null,
      input_json: data.input_json ?? null,
      status: 'running',
      started_at: new Date(),
    });

    return this.repository.save(entity);
  }

  async completeAttempt(
    id: string,
    data: {
      status: Exclude<DoctorRepairHistoryStatus, 'running'>;
      result_json?: Record<string, unknown>;
      evidence_json?: Record<string, unknown>;
      error_message?: string | null;
    },
  ): Promise<DoctorRepairHistory | null> {
    const entity = await this.findById(id);
    if (!entity) {
      return null;
    }

    entity.status = data.status;
    entity.finished_at = new Date();
    entity.result_json = data.result_json ?? null;
    entity.evidence_json = data.evidence_json ?? null;
    entity.error_message = data.error_message ?? null;

    return this.repository.save(entity);
  }

  async findById(id: string): Promise<DoctorRepairHistory | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findPaged(params: {
    limit: number;
    offset: number;
    action_id?: string;
    status?: DoctorRepairHistoryStatus;
  }): Promise<{ data: DoctorRepairHistory[]; total: number }> {
    const query = this.repository
      .createQueryBuilder('history')
      .orderBy('history.started_at', 'DESC')
      .offset(params.offset)
      .limit(params.limit);

    if (params.action_id) {
      query.andWhere('history.action_id = :actionId', {
        actionId: params.action_id,
      });
    }

    if (params.status) {
      query.andWhere('history.status = :status', {
        status: params.status,
      });
    }

    const [data, total] = await query.getManyAndCount();
    return { data, total };
  }
}
